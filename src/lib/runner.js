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
  let runId = 0;

  function setRunning(next) {
    if (running === next) return;
    running = next;
    onStateChange(next);
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
    async run(code, fileName) {
      const requestId = ++runId;
      teardown();
      try {
        const { parse } = await import("acorn");
        if (requestId !== runId) return false;
        parse(code, {
          ecmaVersion: "latest",
          sourceType: "script",
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
const sourceName = String(file).replace(/[\\r\\n]/g, "_");
let evaluationFinished = false;
let terminated = false;
const timers = new Set();
const intervals = new Set();

function send(kind, args) {
  self.postMessage({ source: "myide-runner", kind: kind, args: args, file: file });
}

function inspect(value, depth, seen) {
  try {
    depth = depth || 0;
    seen = seen || new WeakSet();
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
    if (value instanceof Date) return { t: "date", v: value.toISOString() };
    if (value instanceof RegExp) return { t: "regexp", v: String(value) };
    if (seen.has(value)) return { t: "circular" };
    if (depth > 4) return { t: "ellipsis" };
    seen.add(value);
    if (Array.isArray(value)) {
      const len = value.length;
      if (len > 5000) return { t: "array", length: len, items: [], more: len };
      const max = 50;
      const items = [];
      for (let i = 0; i < Math.min(len, max); i++) items.push(inspect(value[i], depth + 1, seen));
      return { t: "array", length: len, items: items, more: len > max ? len - max : 0 };
    }
    let keys;
    try { keys = Object.keys(value); }
    catch (error) { return { t: "error", v: "Value is too large to display." }; }
    if (keys.length > 5000) return { t: "object", name: "Object", props: [], more: keys.length };
    const max = 40;
    const name = value.constructor && value.constructor.name && value.constructor.name !== "Object" ? value.constructor.name : "";
    return {
      t: "object",
      name: name,
      props: keys.slice(0, max).map(function (key) { return { k: key, v: inspect(value[key], depth + 1, seen) }; }),
      more: keys.length > max ? keys.length - max : 0,
    };
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

["log", "info", "warn", "error", "debug"].forEach(function (kind) {
  console[kind] = function () {
    try { send(kind, Array.from(arguments).map(function (arg) { return inspect(arg); })); }
    catch (error) { send("error", [inspect(error)]); }
  };
});
console.table = function (value) { send("log", [inspect(value)]); };
console.dir = function (value) { send("log", [inspect(value)]); };
console.assert = function (condition) {
  if (condition) return;
  const args = Array.prototype.slice.call(arguments, 1);
  send("error", [inspect(args.length ? "Assertion failed: " + args.join(" ") : "Assertion failed")]);
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
    const result = (0, eval)(source + "\\n//# sourceURL=" + sourceName);
    if (result && typeof result.then === "function") await result;
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
      setRunning(true);
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
