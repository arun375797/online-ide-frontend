const RUN_TIMEOUT_MS = 2000;

export function createRunner(onMessage) {
  let frame = null;
  let objectUrl = null;
  let watchdog = null;

  function clearWatchdog() {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  }

  function teardown() {
    clearWatchdog();
    if (frame) {
      frame.remove();
      frame = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function onWindowMessage(event) {
    const data = event.data;
    if (!data || data.source !== "myide-runner") return;
    if (data.kind === "__done") {
      clearWatchdog();
      return;
    }
    onMessage(data);
  }

  window.addEventListener("message", onWindowMessage);

  return {
    run(code, fileName) {
      teardown();

      const encoded = JSON.stringify(code).replace(/</g, "\\u003c");
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
</head>
<body>
<script>
(function () {
  const file = ${JSON.stringify(fileName)};
  function send(kind, args) {
    parent.postMessage({ source: "myide-runner", kind, args, file }, "*");
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
      if (type === "function") {
        const name = value.name ? " " + value.name : "";
        return { t: "function", v: "ƒ" + name + "()" };
      }
      if (type !== "object") return { t: "string", v: String(value) };
      if (value instanceof Error) return { t: "error", v: value.stack || String(value) };
      if (value instanceof Date) return { t: "date", v: value.toISOString() };
      if (value instanceof RegExp) return { t: "regexp", v: String(value) };
      if (seen.has(value)) return { t: "circular" };
      if (depth > 4) return { t: "ellipsis" };
      seen.add(value);
      if (Array.isArray(value)) {
        const len = value.length;
        if (len > 5000) {
          return { t: "array", length: len, items: [], more: len };
        }
        const max = 50;
        const items = [];
        for (let i = 0; i < Math.min(len, max); i++) {
          items.push(inspect(value[i], depth + 1, seen));
        }
        return { t: "array", length: len, items: items, more: len > max ? len - max : 0 };
      }
      let keys;
      try {
        keys = Object.keys(value);
      } catch (err) {
        return { t: "error", v: "Value is too large to display." };
      }
      if (keys.length > 5000) {
        return { t: "object", name: "Object", props: [], more: keys.length };
      }
      const max = 40;
      const name = value.constructor && value.constructor.name && value.constructor.name !== "Object"
        ? value.constructor.name
        : "";
      return {
        t: "object",
        name: name,
        props: keys.slice(0, max).map(function (k) { return { k: k, v: inspect(value[k], depth + 1, seen) }; }),
        more: keys.length > max ? keys.length - max : 0,
      };
    } catch (err) {
      return { t: "error", v: err && err.message ? err.message : "Could not display value." };
    }
  }
  ["log", "info", "warn", "error", "debug"].forEach((kind) => {
    console[kind] = (...args) => {
      try {
        send(kind, args.map(function (arg) { return inspect(arg); }));
      } catch (err) {
        send("error", [inspect(err)]);
      }
    };
  });
  console.table = (value) => {
    send("log", [inspect(value)]);
  };
  window.onerror = (message, src, line, col, error) => {
    send("error", [inspect(error || String(message) + " (" + line + ":" + col + ")")]);
  };
  window.onunhandledrejection = (event) => {
    send("error", [inspect(event.reason)]);
  };

  const source = ${encoded};
  (async () => {
    try {
      const result = await (0, eval)("(async () => {\\n" + source + "\\n})()");
      if (result !== undefined) send("result", [inspect(result)]);
    } catch (error) {
      send("error", [inspect(error)]);
    } finally {
      parent.postMessage({ source: "myide-runner", kind: "__done", file: file }, "*");
    }
  })();
})();
</script>
</body>
</html>`;

      const blob = new Blob([html], { type: "text/html" });
      objectUrl = URL.createObjectURL(blob);
      frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.style.display = "none";
      frame.src = objectUrl;
      document.body.appendChild(frame);

      watchdog = setTimeout(() => {
        teardown();
        onMessage({
          kind: "error",
          args: [
            {
              t: "error",
              v: "Run stopped after 2 seconds. This is usually an infinite loop — for reversing an array use left++ and right--, not left-- and right++.",
            },
          ],
          file: fileName,
        });
      }, RUN_TIMEOUT_MS);
    },
    destroy() {
      window.removeEventListener("message", onWindowMessage);
      teardown();
    },
  };
}
