import test from "node:test";
import assert from "node:assert/strict";
import { traceProgram } from "./traceProgram.js";
import { traceNativeJavaScript } from "./nativeVisualizer.js";
import { buildMemoryGraph, prepareMemorySource } from "./memoryGraph.js";

const matrix = `const A = [[2,4,6],[1,3,5]];
const B = [[10,20,30],[40,50,60]];
const result = [];
for (let i=0;i<A.length;i++) {
  result[i]=[];
  for (let j=0;j<A[i].length;j++) {
    result[i][j]=A[i][j]+B[i][j];
  }
}
console.log(result);`;

test("the memory scene grows with declarations and never draws future structures", async () => {
  const trace = await traceProgram(matrix);
  const source = prepareMemorySource(matrix);
  const first = trace.events.findIndex(
    (step) => step.variables.A && !step.variables.B,
  );
  const initial = buildMemoryGraph(trace.events, first, source);
  assert.equal(initial.heap.length, 1);
  assert.deepEqual(initial.heap[0].names, ["A"]);
  assert.deepEqual(
    initial.scopes[0].rows.map((row) => row.name),
    ["A"],
  );
  const partial = trace.events.findIndex(
    (step) => step.write?.path.join(",") === "0,0",
  );
  const scene = buildMemoryGraph(trace.events, partial, source);
  assert.deepEqual(
    scene.heap.map((node) => node.names[0]),
    ["A", "B", "result"],
  );
  assert.deepEqual(
    scene.heap.find((node) => node.names.includes("result")).value,
    [[12]],
  );
  assert.deepEqual(
    scene.scopes[0].loops.map((loop) =>
      loop.rows.map((row) => [row.name, row.value]),
    ),
    [[["i", 0]], [["j", 0]]],
  );
  assert.equal(
    scene.inlineRows.size,
    5,
    "numeric matrix rows are rendered inside their parent grid",
  );
});

test("matrix allocation IDs and order stay fixed while the result table gains rows", async () => {
  const trace = await traceProgram(matrix);
  const writes = trace.events
    .map((step, index) => [step, index])
    .filter(([step]) => step.write?.path.length === 2);
  const first = buildMemoryGraph(trace.events, writes[0][1]);
  const last = buildMemoryGraph(trace.events, writes.at(-1)[1]);
  assert.deepEqual(
    first.heap.map((node) => node.id),
    last.heap.map((node) => node.id),
  );
  assert.deepEqual(
    last.heap.find((node) => node.names.includes("result")).value,
    [
      [12, 24, 36],
      [41, 53, 65],
    ],
  );
  assert.equal(
    last.scopes[0].rows.find((row) => row.name === "result").reference,
    first.scopes[0].rows.find((row) => row.name === "result").reference,
  );
  const rewind = buildMemoryGraph(trace.events, writes[0][1]);
  assert.deepEqual(
    rewind.heap.find((node) => node.names.includes("result")).value,
    [[12]],
  );
});

test("aliases share a single node while equal-valued allocations remain distinct", async () => {
  const trace = await traceProgram(
    "const a=[1];const alias=a;const b=[1];a[0]=2;",
  );
  const graph = buildMemoryGraph(trace.events, trace.events.length - 1);
  assert.equal(graph.heap.length, 2);
  const rows = graph.scopes[0].rows;
  assert.equal(
    rows.find((row) => row.name === "a").reference,
    rows.find((row) => row.name === "alias").reference,
  );
  assert.notEqual(
    rows.find((row) => row.name === "a").reference,
    rows.find((row) => row.name === "b").reference,
  );
  assert.deepEqual(graph.heap.find((node) => node.names.includes("a")).names, [
    "a",
    "alias",
  ]);
  assert.deepEqual(
    graph.heap.find((node) => node.names.includes("b")).value,
    [1],
  );
});

test("native object identities survive property writes, aliases, and cycles", async () => {
  const trace = await traceNativeJavaScript(
    "const object={child:{value:1}};const alias=object;object.child.value=2;object.self=object;",
  );
  assert.equal(trace.error, "");
  const graph = buildMemoryGraph(trace.events, trace.events.length - 1);
  assert.equal(graph.heap.length, 2);
  const root = graph.heap.find((node) => node.names.includes("object"));
  assert.deepEqual(root.names, ["object", "alias"]);
  assert.equal(
    root.links.find((link) => link.key === "self").reference,
    root.id,
  );
  const child = graph.objects.get(
    root.links.find((link) => link.key === "child").reference,
  );
  assert.deepEqual(child.value, { value: 2 });
  assert.equal(
    child.live,
    undefined,
    "layout annotations do not mutate recorded heap snapshots",
  );
  assert.doesNotThrow(() => structuredClone(trace));
});

test("lost references keep their existing structure and stepping backward removes future allocations", async () => {
  const source = "let value={x:1};\nvalue=null;\nconst later={y:2};";
  const trace = await traceProgram(source);
  const first = trace.events.findIndex(
    (step) => step.variables.value?.reference,
  );
  const graph = buildMemoryGraph(trace.events, trace.events.length - 1);
  const former = graph.heap.find((node) => node.names.includes("value"));
  assert.equal(former.live, false);
  assert.deepEqual(former.value, { x: 1 });
  const rewind = buildMemoryGraph(trace.events, first);
  assert.equal(rewind.heap.length, 1);
  assert.equal(rewind.heap[0].live, true);
});

test("function parameters reference the same array and loop variables belong to their calling frame", async () => {
  const source =
    "const values=[2,3];\nfunction add(items){let total=0;for(let i=0;i<items.length;i++){total+=items[i];}return total;}\nconsole.log(add(values));";
  const trace = await traceProgram(source);
  const index = trace.events.findIndex(
    (step) => step.changed === "total" && step.type === "assignment",
  );
  const graph = buildMemoryGraph(
    trace.events,
    index,
    prepareMemorySource(source),
  );
  assert.equal(graph.scopes.length, 2);
  const globals = graph.scopes[0];
  const fn = graph.scopes[1];
  assert.equal(fn.name, "add()");
  assert.equal(globals.loops.length, 0);
  assert.equal(fn.loops.length, 1);
  assert.equal(
    globals.rows.find((row) => row.name === "values").reference,
    fn.rows.find((row) => row.name === "items").reference,
  );
  assert.equal(graph.heap.length, 1);
  assert.ok(
    fn.rows.some((row) => row.name === "total"),
    "a variable declared before the loop stays in its function scope",
  );
});

test("an array created inside a global loop has a real target and lives in that loop's table", async () => {
  const source = "for(let i=0;i<1;i++){const local=[7,8];console.log(local);}";
  const trace = await traceProgram(source);
  const index = trace.events.findIndex((step) => step.variables.local);
  const graph = buildMemoryGraph(
    trace.events,
    index,
    prepareMemorySource(source),
  );
  const loop = graph.scopes[0].loops[0];
  const row = loop.rows.find((item) => item.name === "local");
  assert.ok(row);
  assert.ok(graph.heap.some((node) => node.id === row.reference));
});

test("a variable referencing a matrix row connects to the inline row instead of duplicating the array", async () => {
  const trace = await traceProgram(
    "const matrix=[[1,2],[3,4]];const row=matrix[0];row[1]=9;",
  );
  const graph = buildMemoryGraph(trace.events, trace.events.length - 1);
  assert.equal(graph.heap.length, 1);
  const row = graph.scopes[0].rows.find((item) => item.name === "row");
  assert.equal(graph.inlineRows.get(row.reference).row, 0);
  assert.equal(graph.inlineRows.get(row.reference).parent, graph.heap[0].id);
  assert.deepEqual(graph.heap[0].value[0], [1, 9]);
});
