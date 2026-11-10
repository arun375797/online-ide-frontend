import { traceJavaScript } from "./visualizer.js";

export async function traceProgram(source) {
  if (typeof source !== "string" || source.length > 30_000)
    throw new Error(
      "Code is too long to visualize (maximum 30,000 characters).",
    );
  const { traceNativeJavaScript } = await import("./nativeVisualizer.js");
  const native = await traceNativeJavaScript(source);
  if (native.error) return native;
  // Rich operand diagrams are retained only when they agree with real execution.
  // Native execution remains authoritative for every program.
  try {
    const detailed = traceJavaScript(source);
    const snapshot = (result) =>
      Object.fromEntries(
        Object.entries(result.events.at(-1)?.variables || {})
          .filter(([, entry]) => entry.type !== "function")
          .map(([name, entry]) => [name, entry.value]),
      );
    if (
      !detailed.error &&
      JSON.stringify(detailed.output) === JSON.stringify(native.output) &&
      JSON.stringify(snapshot(detailed)) === JSON.stringify(snapshot(native))
    )
      return { ...detailed, engine: "detailed" };
  } catch {
    /* General JavaScript keeps its native statement snapshots. */
  }
  return native;
}
