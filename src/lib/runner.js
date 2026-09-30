export function createRunner(onMessage, onStateChange = () => {}) {
  let worker = null;
  let objectUrl = null;
  let running = false;

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
    run(code, fileName) {
      teardown();
      const encoded = JSON.stringify(code);
      const workerSource = `
const file = ${JSON.stringify(fileName)};
let evaluationFinished = false;
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

["log", "info", "warn", "error", "debug"].forEach(function (kind) {
  console[kind] = function () {
    try { send(kind, Array.from(arguments).map(function (arg) { return inspect(arg); })); }
    catch (error) { send("error", [inspect(error)]); }
  };
});
console.table = function (value) { send("log", [inspect(value)]); };

const nativeSetTimeout = self.setTimeout.bind(self);
const nativeClearTimeout = self.clearTimeout.bind(self);
const nativeSetInterval = self.setInterval.bind(self);
const nativeClearInterval = self.clearInterval.bind(self);

function finishIfIdle() {
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
    } catch (error) { send("error", [inspect(error)]); }
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
    } catch (error) { send("error", [inspect(error)]); }
  }, delay);
  intervals.add(id);
  return id;
};
self.clearInterval = function (id) { intervals.delete(id); nativeClearInterval(id); finishIfIdle(); };

self.onerror = function (message, source, line, column, error) {
  send("error", [inspect(error || String(message) + " (" + line + ":" + column + ")")]);
  return true;
};
self.onunhandledrejection = function (event) { send("error", [inspect(event.reason)]); };

const source = ${encoded};
(async function () {
  try {
    const result = await (0, eval)("(async () => {\\n" + source + "\\n})()");
    if (result !== undefined) send("result", [inspect(result)]);
  } catch (error) { send("error", [inspect(error)]); }
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
    },

    stop() {
      if (!worker) return false;
      teardown();
      return true;
    },

    isRunning() {
      return running;
    },

    destroy() {
      teardown();
    },
  };
}
