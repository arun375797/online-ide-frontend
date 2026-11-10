// This function is serialized into the isolated VM. It has no host closures.
export function nativeBootstrap(name) {
  const send = globalThis[`${name}_send`];
  const stringify = JSON.stringify;
  const descriptors = Object.getOwnPropertyDescriptors;
  const ownKeys = Object.keys;
  const has = Object.prototype.hasOwnProperty;
  const frames = new Map([
    [0, { id: 0, name: "Global", parent: null, readers: {} }],
  ]);
  const loops = new Map();
  const timers = new Map();
  const NativePromise = Promise;
  const nativeThen = NativePromise.prototype.then;
  const promises = new Map();
  const references = new WeakMap();
  let nextReference = 0;
  function referenceId(value) {
    if (!value || typeof value !== "object") return undefined;
    if (!references.has(value)) references.set(value, `ref-${++nextReference}`);
    return references.get(value);
  }
  const markHandled = (value) => {
    const entry = promises.get(value);
    if (entry) entry.handled = true;
    return value;
  };
  NativePromise.prototype.then = function (...args) {
    markHandled(this);
    return nativeThen.apply(this, args);
  };
  let globalReaders = {};
  let visibleReaders = {};
  let nextFrame = 0;
  let active = 0;
  let currentLine = 1;
  let nextTimer = 0;
  let virtualTime = 0;
  let output = 0;

  function safe(value, depth = 0, seen = new Set()) {
    if (value === undefined) return { $native: "undefined" };
    if (typeof value === "number" && !Number.isFinite(value))
      return { $native: "number", value: String(value) };
    if (typeof value === "bigint")
      return { $native: "display", value: `${value}n` };
    if (typeof value === "symbol")
      return { $native: "display", value: String(value) };
    if (typeof value === "function")
      return {
        $native: "display",
        value: `[Function ${value.name || "anonymous"}]`,
      };
    if (typeof value === "string")
      return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
    if (value === null || typeof value !== "object") return value;
    const id = referenceId(value);
    if (seen.has(value)) return { $native: "reference", id };
    if (depth > 5) return { $native: "display", id, value: "[…]" };
    seen.add(value);
    try {
      if (value instanceof Date)
        return {
          $native: "display",
          id,
          kind: "Date",
          value: Date.prototype.toISOString.call(value),
        };
      if (value instanceof RegExp)
        return {
          $native: "display",
          id,
          kind: "RegExp",
          value: RegExp.prototype.toString.call(value),
        };
      if (value instanceof Map)
        return {
          $native: "object",
          id,
          kind: "Map",
          entries: [
            [
              "Map",
              safe(
                [...Map.prototype.entries.call(value)].slice(0, 50),
                depth + 1,
                seen,
              ),
            ],
          ],
        };
      if (value instanceof Set)
        return {
          $native: "object",
          id,
          kind: "Set",
          entries: [
            [
              "Set",
              safe(
                [...Set.prototype.values.call(value)].slice(0, 100),
                depth + 1,
                seen,
              ),
            ],
          ],
        };
      if (value instanceof Error)
        return {
          $native: "display",
          id,
          kind: "Error",
          value: `${value.name}: ${value.message}`,
        };
      const data = descriptors(value);
      if (Array.isArray(value)) {
        const items = [];
        for (let index = 0; index < Math.min(value.length, 1000); index++) {
          const descriptor = data[index];
          items.push(
            descriptor && has.call(descriptor, "value")
              ? safe(descriptor.value, depth + 1, seen)
              : { $native: "undefined" },
          );
        }
        return { $native: "array", id, items, length: value.length };
      }
      return {
        $native: "object",
        id,
        entries: ownKeys(data)
          .slice(0, 60)
          .map((key) => [
            key,
            has.call(data[key], "value")
              ? safe(data[key].value, depth + 1, seen)
              : { $native: "display", value: "[Getter/Setter]" },
          ]),
      };
    } catch {
      return { $native: "display", value: "[Unavailable]" };
    } finally {
      seen.delete(value);
    }
  }

  function inspect(readers, owner = null) {
    const values = Object.create(null);
    for (const key of ownKeys(readers)) {
      const [get, id, line, kind] = readers[key];
      if (owner !== null && id !== owner) continue;
      try {
        const value = get();
        values[key] = {
          value: safe(value),
          type:
            value === null
              ? "null"
              : Array.isArray(value)
                ? "array"
                : typeof value,
          scope: frames.get(id)?.name || "closure",
          line,
          mutable: kind !== "const" && kind !== "class",
          reference: referenceId(value),
          declaredAt: line,
        };
      } catch {
        /* Uninitialized bindings stay in their real temporal dead zone. */
      }
    }
    return values;
  }

  function update(readers, token) {
    active = token;
    visibleReaders = readers;
    const frame = frames.get(token);
    if (frame) frame.readers = readers;
  }

  function event(
    line,
    type,
    readers = visibleReaders,
    token = active,
    extra = {},
  ) {
    update(readers, token);
    currentLine = line || currentLine;
    const chain = [];
    const seen = new Set();
    for (
      let frame = frames.get(token);
      frame && !seen.has(frame.id);
      frame = frames.get(frame.parent)
    ) {
      seen.add(frame.id);
      chain.unshift(frame);
    }
    if (!chain.some((frame) => frame.id === 0)) chain.unshift(frames.get(0));
    const callStack = chain.map((frame) => ({
      id: frame.id,
      name: frame.name,
      callLine: frame.callLine,
      definitionLine: frame.definitionLine,
      returning: frame.returning || false,
      returnValue: safe(frame.returnValue),
      variables: inspect(
        frame.id === 0
          ? { ...globalReaders, ...(token === 0 ? readers : {}) }
          : frame.readers,
        frame.id,
      ),
    }));
    const variables = inspect(readers);
    const activeLoops = [...loops.values()]
      .filter((loop) => chain.some((frame) => frame.id === loop.owner))
      .map((loop) => ({
        ...loop,
        indexValue: variables[loop.indexName]?.value,
      }));
    const packet = {
      kind: "event",
      line: currentLine,
      column: 0,
      type,
      explanation:
        type === "before"
          ? `About to execute line ${currentLine}.`
          : `Executed line ${currentLine}.`,
      variables,
      callStack,
      loops: activeLoops,
      output,
      reads: [],
      ...extra,
    };
    if (!send(stringify(packet)))
      throw new Error("Visualization limit reached.");
  }

  function printed(value) {
    if (typeof value === "string") return value;
    if (value === undefined) return "undefined";
    if (typeof value === "bigint") return `${value}n`;
    if (value === null || typeof value !== "object") return String(value);
    const encoded = safe(value);
    function readable(item) {
      if (item?.$native === "array")
        return `[${item.items.map(readable).join(", ")}]`;
      if (item?.$native === "object")
        return `{${item.entries.map(([key, val]) => `${JSON.stringify(key)}: ${readable(val)}`).join(", ")}}`;
      if (item?.$native === "undefined") return "undefined";
      if (item?.$native === "reference") return "[Circular]";
      if (item?.$native) return item.value;
      return typeof item === "string" ? stringify(item) : String(item);
    }
    return readable(encoded);
  }

  function log(...args) {
    const text = args.map(printed).join(" ").slice(0, 5000);
    if (!send(stringify({ kind: "output", text })))
      throw new Error("Console output limit reached.");
    output++;
    event(currentLine, "output", visibleReaders, active, {
      explanation: `console displays ${text}.`,
      logged: text,
    });
  }

  globalThis.console = {
    log,
    info: log,
    warn: log,
    error: log,
    debug: log,
    dir: log,
    table: log,
    clear() {},
    group: log,
    groupCollapsed: log,
    groupEnd() {},
    assert(condition, ...args) {
      if (!condition) log("Assertion failed:", ...args);
    },
    time() {},
    timeEnd() {},
    trace: log,
  };
  function schedule(callback, delay = 0, interval = false, args = []) {
    const id = ++nextTimer;
    timers.set(id, {
      callback,
      args,
      due: virtualTime + Math.max(0, Number(delay) || 0),
      interval,
      delay: Math.max(1, Number(delay) || 0),
    });
    return id;
  }
  globalThis.setTimeout = (callback, delay, ...args) =>
    schedule(callback, delay, false, args);
  globalThis.setInterval = (callback, delay, ...args) =>
    schedule(callback, delay, true, args);
  globalThis.clearTimeout = globalThis.clearInterval = (id) =>
    timers.delete(id);
  globalThis.queueMicrotask = (callback) => {
    Promise.resolve().then(callback);
  };

  globalThis[name] = {
    watch(value) {
      try {
        if (value instanceof NativePromise && !promises.has(value)) {
          const entry = { state: "pending", handled: false, line: currentLine };
          promises.set(value, entry);
          nativeThen.call(
            value,
            () => {
              entry.state = "fulfilled";
            },
            (error) => {
              entry.state = "rejected";
              entry.error = error;
            },
          );
        }
      } catch {
        /* Promise-like values keep their native behavior. */
      }
      return value;
    },
    awaited: markHandled,
    globals(readers) {
      globalReaders = readers;
      visibleReaders = readers;
      frames.get(0).readers = readers;
    },
    step(line, type, readers, token) {
      event(line, type, readers, token);
    },
    condition(line, value, readers, token, condition) {
      event(line, "condition", readers, token, {
        condition,
        result: Boolean(value),
        explanation: `${condition} is ${Boolean(value)}.`,
      });
      return value;
    },
    loop(line, indexName, readers, token) {
      const key = `${token}:${line}`;
      const loop = loops.get(key) || {
        line,
        indexName,
        owner: token,
        iteration: 0,
        condition: "",
      };
      loop.iteration++;
      loops.set(key, loop);
      event(line, "loop", readers, token, {
        explanation: `Loop on line ${line}, iteration ${loop.iteration}.`,
      });
    },
    endLoop(line, token) {
      loops.delete(`${token}:${line}`);
    },
    enter(functionName, line, readers) {
      const id = ++nextFrame;
      for (const descriptor of Object.values(readers))
        if (descriptor[1] === -1) descriptor[1] = id;
      frames.set(id, {
        id,
        name: functionName,
        parent: active,
        callLine: currentLine,
        definitionLine: line,
        readers,
      });
      event(line, "call", readers, id, {
        functionName,
        explanation: `Call ${functionName}().`,
      });
      return id;
    },
    returned(value, line, readers, token) {
      const frame = frames.get(token);
      if (frame) {
        frame.returning = true;
        frame.returnValue = value;
      }
      event(line, "return", readers, token, {
        functionName: frame?.name,
        returnValue: safe(value),
        explanation: `${frame?.name || "Function"} returns ${printed(value)}.`,
      });
      return value;
    },
    leave(token) {
      const frame = frames.get(token);
      active = frame?.parent || 0;
      visibleReaders = frames.get(active)?.readers || globalReaders;
      for (const [key, loop] of loops)
        if (loop.owner === token) loops.delete(key);
    },
    timer() {
      const entries = [...timers.entries()].sort(
        (left, right) => left[1].due - right[1].due || left[0] - right[0],
      );
      if (!entries.length) return false;
      const [id, timer] = entries[0];
      virtualTime = timer.due;
      if (timer.interval) timer.due += timer.delay;
      else timers.delete(id);
      if (typeof timer.callback === "function") timer.callback(...timer.args);
      else (0, eval)(String(timer.callback));
      return true;
    },
    finish() {
      for (const entry of promises.values())
        if (entry.state === "rejected" && !entry.handled) {
          const error = new Error(
            `Unhandled promise rejection: ${printed(entry.error)}`,
          );
          error.stack = `visualizer.js:${entry.line}`;
          throw error;
        }
      event(currentLine, "complete", globalReaders, 0, {
        explanation: "Execution complete.",
      });
    },
  };
}
