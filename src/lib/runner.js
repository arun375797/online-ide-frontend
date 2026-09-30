function syntaxFailure(error, fileName) {
  const line = Number(error?.loc?.line) || 1;
  const column = (Number(error?.loc?.column) || 0) + 1;
  const detail = String(error?.message || "Invalid JavaScript").replace(/\s*\(\d+:\d+\)$/, "");
  const message = `SyntaxError: ${detail}\n    at ${fileName}:${line}:${column}`;
  return {
    kind: "error",
    args: [{ t: "error", v: message }],
    message: detail,
    line,
    column,
    file: fileName,
  };
}

export function createRunner(onMessage, onStateChange = () => {}) {
  let worker = null;
  let objectUrl = null;
  let running = false;
  let runningFile = "";
  let runId = 0;

  function setRunning(next, fileName = runningFile) {
    if (running === next) return;
    running = next;
    if (next) runningFile = fileName;
    onStateChange(next, runningFile);
    if (!next) runningFile = "";
  }

  function teardown() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    setRunning(false);
  }

  return {
    async run(code, fileName, { mode = "script" } = {}) {
      const requestId = ++runId;
      teardown();
      try {
        const { parse } = await import("acorn");
        if (requestId !== runId) return false;
        parse(code, {
          ecmaVersion: "latest",
          sourceType: mode === "module" ? "module" : "script",
          allowHashBang: true,
          locations: true,
        });
      } catch (error) {
        onMessage(syntaxFailure(error, fileName));
        return false;
      }

      const encoded = JSON.stringify(code);
      const workerSource = `
const file = ${JSON.stringify(fileName)};
const runtimeMode = ${JSON.stringify(mode)};
const sourceName = String(file).replace(/[\\r\\n]/g, "_");
let evaluationFinished = false;
let terminated = false;
const timers = new Set();
const intervals = new Set();

function send(kind, args, extra) {
  self.postMessage(Object.assign({ source: "myide-runner", kind: kind, args: args, file: file }, extra || {}));
}

function inspectDescriptor(descriptor, depth, ancestors) {
  if (descriptor.get || descriptor.set) {
    return {
      t: "accessor",
      v: descriptor.get && descriptor.set ? "[Getter/Setter]" : descriptor.get ? "[Getter]" : "[Setter]",
    };
  }
  return inspect(descriptor.value, depth, ancestors);
}

function inspect(value, depth, ancestors) {
  try {
    depth = depth || 0;
    ancestors = ancestors || new WeakSet();
    if (value === null) return { t: "null" };
    const type = typeof value;
    if (type === "undefined") return { t: "undefined" };
    if (type === "string") return { t: "string", v: value };
    if (type === "number") {
      if (Number.isNaN(value)) return { t: "number", v: "NaN" };
      if (value === Infinity) return { t: "number", v: "Infinity" };
      if (value === -Infinity) return { t: "number", v: "-Infinity" };
      return { t: "number", v: Object.is(value, -0) ? "-0" : String(value) };
    }
    if (type === "boolean") return { t: "boolean", v: String(value) };
    if (type === "bigint") return { t: "bigint", v: String(value) };
    if (type === "symbol") return { t: "symbol", v: String(value) };
    if (type === "function") return { t: "function", v: "ƒ" + (value.name ? " " + value.name : "") + "()" };
    if (type !== "object") return { t: "string", v: String(value) };
    if (value instanceof Error) return { t: "error", v: value.stack || String(value) };
    if (value instanceof Date) return { t: "date", v: Date.prototype.toISOString.call(value) };
    if (value instanceof RegExp) return { t: "regexp", v: String(value) };
    if (value instanceof Promise) return { t: "promise", v: "Promise { <state unavailable in snapshot> }" };
    if (ancestors.has(value)) return { t: "circular" };
    if (depth > 4) return { t: "ellipsis" };
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const len = value.length;
        if (len > 5000) return { t: "array", length: len, items: [], more: len };
        const max = 50;
        const items = [];
        for (let i = 0; i < Math.min(len, max); i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          items.push(descriptor ? inspectDescriptor(descriptor, depth + 1, ancestors) : { t: "empty" });
        }
        return { t: "array", length: len, items: items, more: len > max ? len - max : 0 };
      }
      if (value instanceof Map) {
        const size = Object.getOwnPropertyDescriptor(Map.prototype, "size").get.call(value);
        const entries = [];
        let count = 0;
        for (const pair of Map.prototype.entries.call(value)) {
          if (count++ >= 40) break;
          entries.push({ k: inspect(pair[0], depth + 1, ancestors), v: inspect(pair[1], depth + 1, ancestors) });
        }
        return { t: "map", size: size, entries: entries, more: Math.max(0, size - entries.length) };
      }
      if (value instanceof Set) {
        const size = Object.getOwnPropertyDescriptor(Set.prototype, "size").get.call(value);
        const items = [];
        let count = 0;
        for (const item of Set.prototype.values.call(value)) {
          if (count++ >= 40) break;
          items.push(inspect(item, depth + 1, ancestors));
        }
        return { t: "set", size: size, items: items, more: Math.max(0, size - items.length) };
      }
      let keys;
      try { keys = Reflect.ownKeys(value); }
      catch (error) { return { t: "error", v: "Value could not be inspected safely." }; }
      if (keys.length > 5000) return { t: "object", name: "Object", props: [], more: keys.length };
      const max = 40;
      const props = [];
      for (const key of keys.slice(0, max)) {
        let descriptor;
        try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
        catch (error) { descriptor = null; }
        props.push({
          k: typeof key === "symbol" ? "[" + String(key) + "]" : String(key),
          v: descriptor ? inspectDescriptor(descriptor, depth + 1, ancestors) : { t: "unavailable", v: "[Unavailable]" },
        });
      }
      return { t: "object", name: "", props: props, more: keys.length > max ? keys.length - max : 0 };
    } finally {
      ancestors.delete(value);
    }
  } catch (error) {
    return { t: "error", v: error && error.message ? error.message : "Could not display value." };
  }
}

function sendError(error) {
  const stack = error && error.stack ? String(error.stack) : String(error);
  const locationLine = stack.split("\\n").find(function (line) {
    return line.indexOf(sourceName + ":") !== -1;
  });
  const match = locationLine && locationLine.match(/:(\\d+):(\\d+)\\)?$/);
  self.postMessage({
    source: "myide-runner",
    kind: "error",
    args: [inspect(error)],
    message: error && error.message ? error.message : String(error),
    line: match ? Number(match[1]) : undefined,
    column: match ? Number(match[2]) : undefined,
    file: file,
  });
}

function fail(error) {
  if (terminated) return;
  terminated = true;
  sendError(error);
  self.postMessage({ source: "myide-runner", kind: "__done", file: file });
  self.close();
}

let groupDepth = 0;

function sendConsole(kind, values) {
  const args = Array.from(values);
  if (typeof args[0] !== "string" || !/%[sdifoOc%]/.test(args[0])) {
    send(kind, args.map(function (arg) { return inspect(arg); }), { indent: groupDepth });
    return;
  }
  const format = args.shift();
  const nodes = [];
  let text = "";
  let index = 0;
  format.replace(/%[sdifoOc%]/g, function (token, offset) {
    text += format.slice(index, offset);
    index = offset + 2;
    if (token === "%%") { text += "%"; return token; }
    if (!args.length) { text += token; return token; }
    const value = args.shift();
    if (token === "%c") return token;
    if (token === "%o" || token === "%O") {
      if (text) nodes.push({ t: "string", v: text });
      text = "";
      nodes.push(inspect(value));
      return token;
    }
    if (token === "%d" || token === "%f") text += String(Number(value));
    else if (token === "%i") text += String(parseInt(value, 10));
    else text += String(value);
    return token;
  });
  text += format.slice(index);
  if (text) nodes.push({ t: "string", v: text });
  args.forEach(function (arg) { nodes.push(inspect(arg)); });
  send(kind, nodes, { indent: groupDepth });
}

["log", "info", "warn", "error", "debug"].forEach(function (kind) {
  console[kind] = function () {
    try { sendConsole(kind, arguments); }
    catch (error) { send("error", [inspect(error)]); }
  };
});
console.table = function (value) { send("table", [inspect(value)], { indent: groupDepth }); };
console.dir = function (value) { send("log", [inspect(value)], { indent: groupDepth }); };
console.clear = function () { send("__clear", []); };
console.trace = function () {
  const label = Array.from(arguments).map(String).join(" ");
  const stack = new Error(label || "Trace").stack || label || "Trace";
  send("trace", [{ t: "plain", v: stack }], { indent: groupDepth });
};
console.group = console.groupCollapsed = function () {
  sendConsole("group", arguments);
  groupDepth += 1;
};
console.groupEnd = function () { groupDepth = Math.max(0, groupDepth - 1); };
console.assert = function (condition) {
  if (condition) return;
  const args = Array.prototype.slice.call(arguments, 1);
  if (!args.length) args.push("Assertion failed");
  else if (typeof args[0] === "string") args[0] = "Assertion failed: " + args[0];
  else args.unshift("Assertion failed:");
  sendConsole("error", args);
};

const consoleTimers = new Map();
const consoleCounts = new Map();
console.time = function (label) { consoleTimers.set(String(label || "default"), performance.now()); };
console.timeLog = function (label) {
  const key = String(label || "default");
  if (!consoleTimers.has(key)) return;
  send("log", [inspect(key + ": " + (performance.now() - consoleTimers.get(key)).toFixed(3) + "ms")]);
};
console.timeEnd = function (label) {
  const key = String(label || "default");
  if (!consoleTimers.has(key)) return;
  send("log", [inspect(key + ": " + (performance.now() - consoleTimers.get(key)).toFixed(3) + "ms")]);
  consoleTimers.delete(key);
};
console.count = function (label) {
  const key = String(label || "default");
  const count = (consoleCounts.get(key) || 0) + 1;
  consoleCounts.set(key, count);
  send("log", [inspect(key + ": " + count)]);
};
console.countReset = function (label) { consoleCounts.delete(String(label || "default")); };

const nativeSetTimeout = self.setTimeout.bind(self);
const nativeClearTimeout = self.clearTimeout.bind(self);
const nativeSetInterval = self.setInterval.bind(self);
const nativeClearInterval = self.clearInterval.bind(self);

function finishIfIdle() {
  if (terminated) return;
  if (evaluationFinished && timers.size === 0 && intervals.size === 0) {
    self.postMessage({ source: "myide-runner", kind: "__done", file: file });
    self.close();
  }
}

self.setTimeout = function (callback, delay) {
  const args = Array.prototype.slice.call(arguments, 2);
  let id;
  id = nativeSetTimeout(function () {
    timers.delete(id);
    try {
      if (typeof callback === "function") callback.apply(self, args);
      else (0, eval)(String(callback));
    } catch (error) { fail(error); }
    finally { finishIfIdle(); }
  }, delay);
  timers.add(id);
  return id;
};
self.clearTimeout = function (id) { timers.delete(id); nativeClearTimeout(id); finishIfIdle(); };

self.setInterval = function (callback, delay) {
  const args = Array.prototype.slice.call(arguments, 2);
  const id = nativeSetInterval(function () {
    try {
      if (typeof callback === "function") callback.apply(self, args);
      else (0, eval)(String(callback));
    } catch (error) { fail(error); }
  }, delay);
  intervals.add(id);
  return id;
};
self.clearInterval = function (id) { intervals.delete(id); nativeClearInterval(id); finishIfIdle(); };

self.onerror = function (message, source, line, column, error) {
  fail(error || new Error(String(message) + " (" + line + ":" + column + ")"));
  return true;
};
self.onunhandledrejection = function (event) { fail(event.reason); };

const source = ${encoded};
(async function () {
  try {
    if (runtimeMode === "module") {
      const moduleBlob = new Blob([source + "\\n//# sourceURL=" + sourceName], { type: "text/javascript" });
      const moduleUrl = URL.createObjectURL(moduleBlob);
      try { await import(moduleUrl); }
      finally { URL.revokeObjectURL(moduleUrl); }
    } else {
      const result = (0, eval)(source + "\\n//# sourceURL=" + sourceName);
      if (result && typeof result.then === "function") await result;
    }
  } catch (error) { fail(error); return; }
  finally { evaluationFinished = true; finishIfIdle(); }
})();
`;

      const blob = new Blob([workerSource], { type: "text/javascript" });
      objectUrl = URL.createObjectURL(blob);
      worker = new Worker(objectUrl);
      worker.onmessage = (event) => {
        const data = event.data;
        if (!data || data.source !== "myide-runner") return;
        if (data.kind === "__done") {
          teardown();
          return;
        }
        onMessage(data);
      };
      worker.onerror = (event) => {
        onMessage({ kind: "error", args: [{ t: "error", v: event.message || "The JavaScript worker crashed." }], file: fileName });
        teardown();
      };
      setRunning(true, fileName);
      return true;
    },

    stop() {
      runId += 1;
      if (!worker) return false;
      teardown();
      return true;
    },

    isRunning() {
      return running;
    },

    destroy() {
      runId += 1;
      teardown();
    },
  };
}
