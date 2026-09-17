export function createRunner(onMessage) {
  let frame = null;
  let objectUrl = null;

  function teardown() {
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
      const max = 50;
      return {
        t: "array",
        length: value.length,
        items: value.slice(0, max).map(function (item) { return inspect(item, depth + 1, seen); }),
        more: value.length > max ? value.length - max : 0,
      };
    }
    const keys = Object.keys(value);
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
  }
  ["log", "info", "warn", "error", "debug"].forEach((kind) => {
    const original = console[kind].bind(console);
    console[kind] = (...args) => {
      send(kind, args.map(function (arg) { return inspect(arg); }));
      original(...args);
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
    },
    destroy() {
      window.removeEventListener("message", onWindowMessage);
      teardown();
    },
  };
}
