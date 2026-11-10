import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import { instrumentJavaScript } from "./nativeInstrumentation.js";
import { nativeBootstrap } from "./nativeBootstrap.js";

let enginePromise;
export function loadJavaScriptEngine() {
  return (enginePromise ||= newQuickJSWASMModuleFromVariant(variant));
}

function decode(value) {
  if (!value || typeof value !== "object") return value;
  if (value.$native === "undefined") return undefined;
  if (value.$native === "number") return Number(value.value);
  if (value.$native === "display") return value.value;
  if (value.$native === "reference") return "[Circular]";
  if (value.$native === "array") return value.items.map(decode);
  if (value.$native === "object")
    return Object.fromEntries(
      value.entries.map(([key, item]) => [key, decode(item)]),
    );
  if (Array.isArray(value)) return value.map(decode);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, decode(item)]),
  );
}

function extractHeap(packet) {
  const heap = new Map();
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.id && value.$native && value.$native !== "reference") {
      if (heap.has(value.id)) return;
      const children =
        value.$native === "array"
          ? value.items.map((item, index) => [String(index), item])
          : value.$native === "object"
            ? value.entries
            : [];
      const links = ["Map", "Set"].includes(value.kind)
        ? []
        : children
            .filter(([, item]) => item?.id)
            .map(([key, item]) => ({ key, reference: item.id }));
      heap.set(value.id, {
        id: value.id,
        kind: value.kind || (value.$native === "array" ? "array" : "object"),
        value: decode(value),
        links,
        length: value.length,
      });
      if (!["Map", "Set"].includes(value.kind))
        children.forEach(([, item]) => visit(item));
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
    else Object.values(value).forEach(visit);
  }
  visit(packet.variables);
  visit(packet.callStack);
  return [...heap.values()];
}

export async function traceNativeJavaScript(
  source,
  { timeoutMs = 2500, maxSteps = 2000 } = {},
) {
  if (typeof source !== "string" || source.length > 30_000)
    throw new Error(
      "Code is too long to visualize (maximum 30,000 characters).",
    );
  let instrumented;
  try {
    instrumented = instrumentJavaScript(source);
  } catch (error) {
    throw new Error(
      `Syntax error at ${error.loc?.line || 1}:${(error.loc?.column || 0) + 1}: ${error.message}`,
    );
  }
  const engine = await loadJavaScriptEngine();
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const vm = runtime.newContext();
  const deadline = Date.now() + timeoutMs;
  const events = [];
  const output = [];
  let outputLength = 0;
  let snapshotLength = 0;
  let limit = "";
  let errorText = "";
  let mainHandle;
  runtime.setInterruptHandler(() => {
    if (Date.now() >= deadline)
      limit ||= "Visualization exceeded its execution time limit.";
    return Boolean(limit);
  });

  const receiver = vm.newFunction("recordVisualization", (json) => {
    if (limit) return vm.false;
    const text = vm.getString(json);
    if (text.length > 1_000_000) {
      limit = "A visualization snapshot is too large.";
      return vm.false;
    }
    const rawPacket = JSON.parse(text);
    const packet = decode(rawPacket);
    if (packet.kind === "output") {
      outputLength += packet.text.length;
      if (output.length >= 250 || outputLength > 25_000) {
        limit = "Console output limit reached.";
        return vm.false;
      }
      output.push(packet.text);
    } else {
      snapshotLength += text.length;
      if (events.length >= maxSteps || snapshotLength > 16_000_000) {
        limit = "Visualization stopped at its step or snapshot limit.";
        return vm.false;
      }
      delete packet.kind;
      events.push({
        ...packet,
        heap: extractHeap(rawPacket),
        step: events.length + 1,
      });
    }
    return vm.true;
  });
  vm.setProp(vm.global, `${instrumented.helperName}_send`, receiver);
  receiver.dispose();

  function failure(handle) {
    if (limit) return { message: limit };
    const value = vm.dump(handle);
    return typeof value === "object" && value
      ? value
      : { message: String(value) };
  }
  function evaluate(code, filename = "myide-runtime.js", options) {
    const result = vm.evalCode(code, filename, options);
    if (result.error) {
      const error = failure(result.error);
      result.error.dispose();
      throw error;
    }
    return result.value;
  }
  function runHelper(method) {
    const result = evaluate(
      `globalThis[${JSON.stringify(instrumented.helperName)}].${method}()`,
    );
    const value = vm.getNumber(result);
    result.dispose();
    return value;
  }

  try {
    evaluate(
      `(${nativeBootstrap.toString()})(${JSON.stringify(instrumented.helperName)})`,
    ).dispose();
    mainHandle = evaluate(instrumented.code, "visualizer.js", {
      type: instrumented.module ? "module" : "global",
    });
    while (true) {
      if (limit || Date.now() >= deadline)
        throw {
          message: limit || "Visualization exceeded its execution time limit.",
        };
      if (runtime.hasPendingJob()) {
        const jobs = runtime.executePendingJobs(100);
        if (jobs.error) {
          const error = failure(jobs.error);
          jobs.error.dispose();
          throw error;
        }
        continue;
      }
      if (!runHelper("timer")) break;
    }
    if (instrumented.module) {
      const state = vm.getPromiseState(mainHandle);
      if (state.type === "rejected") {
        const error = failure(state.error);
        state.error.dispose();
        throw error;
      }
      if (state.type === "pending")
        throw {
          message:
            "Execution is waiting for a promise that cannot resolve in this workspace.",
        };
      if (state.value !== mainHandle) state.value.dispose();
    }
    runHelper("finish");
  } catch (error) {
    errorText = limit || error.message || String(error);
    if (
      /\b(document|window|require|process|fetch)\b.*not defined/.test(errorText)
    )
      errorText +=
        " This workspace provides JavaScript built-ins and console, not browser DOM, Node.js, or network APIs.";
    const match = String(error.stack || "").match(
      /visualizer\.js:(\d+)(?::(\d+))?/,
    );
    const last = events.at(-1);
    events.push({
      step: events.length + 1,
      type: "error",
      line: match ? Number(match[1]) : last?.line || 1,
      column: 0,
      explanation: errorText,
      variables: last?.variables || {},
      callStack: last?.callStack || [{ id: 0, name: "Global", variables: {} }],
      loops: last?.loops || [],
      reads: [],
      heap: last?.heap || [],
      output: output.length,
    });
  } finally {
    mainHandle?.dispose();
    vm.dispose();
    runtime.dispose();
  }
  return { events, output, error: errorText, engine: "javascript" };
}
