import { traceProgram } from "./traceProgram.js";

self.addEventListener("message", async (event) => {
  if (event.data?.type !== "trace") return;
  try {
    self.postMessage({
      type: "result",
      result: await traceProgram(event.data.source),
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error.message || "Could not trace this program.",
    });
  }
});
