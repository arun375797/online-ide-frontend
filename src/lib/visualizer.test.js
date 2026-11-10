import test from "node:test";
import assert from "node:assert/strict";
import { traceJavaScript } from "./visualizer.js";
import {
  cellState,
  collectArrayShapes,
  focusedCell,
} from "./executionDiagram.js";

const deletionExample = `let arr = [10, 20, 30, 40, 50];
let n = 3;

if (n >= 1 && n <= arr.length) {
  for (let i = n - 1; i < arr.length - 1; i++) {
    arr[i] = arr[i + 1];
  }

  arr.length--;
}

console.log(arr);`;

test("records the acceptance example's exact array changes and output", () => {
  const result = traceJavaScript(deletionExample);
  assert.equal(result.error, "");

  const writes = result.events.filter(
    (event) => event.type === "assignment" && event.changed.startsWith("arr["),
  );
  assert.deepEqual(
    writes.map((event) => [
      event.changed,
      event.previous,
      event.arrayName,
      event.arrayIndex,
      event.line,
      event.variables.arr.value,
    ]),
    [
      ["arr[i]", 30, "arr", 2, 6, [10, 20, 40, 40, 50]],
      ["arr[i]", 40, "arr", 3, 6, [10, 20, 40, 50, 50]],
    ],
  );

  const conditionEvents = result.events.filter(
    (event) => event.type === "condition" || event.type === "loop-condition",
  );
  assert.deepEqual(
    conditionEvents.map((event) => [event.condition, event.result]),
    [
      ["n >= 1 && n <= arr.length", true],
      ["i < arr.length - 1", true],
      ["i < arr.length - 1", true],
      ["i < arr.length - 1", false],
    ],
  );
  assert.deepEqual(result.output, ["[10, 20, 40, 50]"]);
  assert.deepEqual(result.events.at(-1).variables.arr.value, [10, 20, 40, 50]);
  const lengthChange = result.events.find(
    (event) => event.changed === "arr.length",
  );
  assert.equal(lengthChange.previous, 5);
  assert.equal(lengthChange.variables.arr.value.length, 4);
});

test("captures assignments, previous values, and conditional branches", () => {
  const result = traceJavaScript(
    "let sum = 2;\nsum += 3;\nif (sum === 5) { sum = sum * 2; }",
  );
  assert.equal(result.error, "");
  assert.deepEqual(
    result.events
      .filter((event) => event.changed === "sum")
      .map((event) => event.variables.sum.value),
    [2, 5, 10],
  );
  assert.equal(
    result.events.find((event) => event.type === "condition").result,
    true,
  );
});

test("reports syntax errors and rejects unsupported executable syntax", () => {
  assert.throws(() => traceJavaScript("let x = ;"), /Syntax error at 1:/);
  const result = traceJavaScript("fetch('https://example.test')");
  assert.match(result.error, /Unsupported JavaScript syntax/);
  assert.deepEqual(result.output, []);
});

test("applies source and loop limits", () => {
  assert.throws(() => traceJavaScript(" ".repeat(30_001)), /Code is too long/);
  const result = traceJavaScript("for (let i = 0; i < 501; i++) {}");
  assert.match(result.error, /exceeded 500 iterations/);
});

const matrixExample = `const A = [[2, 4, 6], [1, 3, 5]];
const B = [[10, 20, 30], [40, 50, 60]];
const result = [];
for (let i = 0; i < A.length; i++) {
  result[i] = [];
  for (let j = 0; j < A[i].length; j++) {
    result[i][j] = A[i][j] + B[i][j];
  }
}
for (let row = 0; row < result.length; row++) {
  console.log(result[row]);
}`;

test("traces each matrix operand and destination with resolved row and column indexes", () => {
  const trace = traceJavaScript(matrixExample);
  assert.equal(trace.error, "");
  const writes = trace.events.filter((event) => event.write?.path.length === 2);
  assert.deepEqual(
    writes.map((event) => [
      event.write.name,
      event.write.path,
      event.write.value,
    ]),
    [
      ["result", [0, 0], 12],
      ["result", [0, 1], 24],
      ["result", [0, 2], 36],
      ["result", [1, 0], 41],
      ["result", [1, 1], 53],
      ["result", [1, 2], 65],
    ],
  );
  assert.deepEqual(writes[1].reads, [
    { name: "A", path: [0, 1], value: 4 },
    { name: "B", path: [0, 1], value: 20 },
  ]);
  assert.deepEqual(writes[1].calculation, {
    operator: "+",
    left: 4,
    right: 20,
    value: 24,
  });
  assert.deepEqual(
    writes[1].loops.map(({ indexName, indexValue }) => [indexName, indexValue]),
    [
      ["i", 0],
      ["j", 1],
    ],
  );
  assert.deepEqual(trace.output, ["[12, 24, 36]", "[41, 53, 65]"]);
  assert.deepEqual(
    writes[0].variables.result.value,
    [[12]],
    "later writes cannot mutate earlier frames",
  );
});

test("diagram highlights match executed matrix accesses and reverse correctly", () => {
  const trace = traceJavaScript(matrixExample);
  const index = trace.events.findIndex(
    (event) =>
      event.write?.name === "result" && event.write.path.join(",") === "1,1",
  );
  const step = trace.events[index];
  const before = trace.events[index - 1].variables;
  assert.equal(cellState("A", [1, 1], step, before).read, true);
  assert.equal(cellState("A", [0, 1], step, before).read, false);
  assert.equal(cellState("result", [1, 1], step, before).written, true);
  assert.equal(cellState("result", [1, 1], step, before).value, 53);
  assert.equal(cellState("result", [1, 2], step, before).exists, false);
  const earlier = trace.events[index - 1];
  assert.equal(
    cellState("result", [1, 1], earlier, trace.events[index - 2].variables)
      .exists,
    false,
  );
  const shapes = collectArrayShapes(trace.events);
  assert.deepEqual(
    shapes.map(({ name, matrix, rows, columns }) => [
      name,
      matrix,
      rows,
      columns,
    ]),
    [
      ["A", true, 2, 3],
      ["B", true, 2, 3],
      ["result", true, 2, 3],
    ],
  );
  assert.deepEqual(focusedCell(step, shapes), {
    name: "result",
    row: 1,
    column: 1,
  });
  assert.deepEqual(focusedCell(trace.events[0], shapes), {
    row: -1,
    column: -1,
  });
});

test("matrix reads, length access, and undefined cells retain their JavaScript meanings", () => {
  const trace = traceJavaScript(
    "const m = [[undefined, 2], [3]]; console.log(m[1].length); m[0][0] = 7; console.log(m[0][0]);",
  );
  assert.equal(trace.error, "");
  assert.deepEqual(trace.output, ["1", "7"]);
  assert.deepEqual(
    trace.events.find((event) => event.type === "output").reads,
    [{ name: "m", path: [1, "length"], value: 1 }],
  );
  assert.equal(cellState("m", [0, 0], trace.events[0], {}).exists, true);
  assert.equal(cellState("m", [1, 1], trace.events[0], {}).exists, false);
  const write = trace.events.find((event) => event.write);
  assert.deepEqual(write.write.path, [0, 0]);
  assert.equal(write.write.previous, undefined);
  assert.equal(trace.events[0].variables.m.value[0][0], undefined);
});

test("runs the user's prime-check function and records its parameters, loop, and global writes", () => {
  const result = traceJavaScript(`let num=4
let count=0
function checkPrime(num){
  for(let i=0;i<=num;i++){
    if(num%i===0){ count++ }
  }
  if(count==2){ console.log('the number is prime ') }
  else console.log('number is not prime ')
}
checkPrime(num)`);
  assert.equal(result.error, "");
  assert.deepEqual(result.output, ["number is not prime "]);
  assert.equal(result.events.at(-1).variables.count.value, 3);
  const increment = result.events.find(
    (event) => event.changed === "count" && event.type === "assignment",
  );
  assert.deepEqual(
    increment.callStack.map((frame) => frame.name),
    ["Global", "checkPrime"],
  );
  assert.equal(increment.callStack[0].variables.num.value, 4);
  assert.equal(increment.callStack[1].variables.num.value, 4);
  assert.equal(increment.callStack[1].variables.i.value, 1);
  assert.equal(increment.callStack[0].variables.count.value, 1);
  assert.equal(
    result.events.find((event) => event.type === "call").callStack[0].variables
      .count.value,
    0,
  );
  assert.equal(result.events.at(-1).callStack.length, 1);
});

test("function declarations are hoisted and calls use lexical scope with shadowed parameters", () => {
  const result = traceJavaScript(`console.log(twice(3));
let value = 2;
function twice(value) { return value * 2; }
function read() { return value; }
function caller() { let value = 99; return read(); }
console.log(caller());
console.log(value);`);
  assert.equal(result.error, "");
  assert.deepEqual(result.output, ["6", "2", "2"]);
  const frame = result.events.find(
    (event) => event.type === "return" && event.functionName === "twice",
  );
  assert.equal(frame.returnValue, 6);
  assert.equal(frame.callStack.at(-1).variables.value.value, 3);
  assert.equal(frame.callStack.at(-1).returning, true);
});

test("returns unwind loops and recursive calls without leaking local variables", () => {
  const result = traceJavaScript(`function fact(n) {
  if (n <= 1) return 1;
  return n * fact(n - 1);
}
function first() {
  for (let i = 0; i < 5; i++) { return i; }
}
console.log(fact(5), first());`);
  assert.equal(result.error, "");
  assert.deepEqual(result.output, ["120 0"]);
  assert.equal(
    Math.max(...result.events.map((event) => event.callStack.length)),
    6,
  );
  assert.equal(result.events.at(-1).callStack.length, 1);
  assert.equal(Object.hasOwn(result.events.at(-1).variables, "n"), false);
  assert.equal(Object.hasOwn(result.events.at(-1).variables, "i"), false);
  assert.equal(result.events.at(-1).loops.length, 0);
});

test("function expressions and returned arrow functions retain captured bindings", () => {
  const result = traceJavaScript(`function make(x) { return (y) => x + y; }
const add = make(4);
const twice = function double(n) { return n * 2; };
console.log(add(3), twice(5));`);
  assert.equal(result.error, "");
  assert.deepEqual(result.output, ["7 10"]);
  assert.ok(
    result.events.some(
      (event) => event.type === "call" && event.functionName === "add",
    ),
  );
  assert.ok(
    result.events.some(
      (event) => event.type === "call" && event.functionName === "double",
    ),
  );
  assert.doesNotThrow(
    () => structuredClone(result),
    "worker results must not contain executable functions or closure objects",
  );
});

test("failed function calls preserve the failing line and local frame", () => {
  const result = traceJavaScript(`function fail(n) {
  let local = n;
  missing + local;
}
fail(5);`);
  assert.match(result.error, /missing.*not defined/);
  const error = result.events.at(-1);
  assert.equal(error.type, "error");
  assert.equal(error.line, 3);
  assert.equal(error.callStack.at(-1).name, "fail");
  assert.equal(error.callStack.at(-1).variables.local.value, 5);
  assert.equal(error.variables.n.value, 5);
});

test("bounds recursion and continues rejecting host code execution", () => {
  const result = traceJavaScript(
    "function recurse() { return recurse(); } recurse();",
  );
  assert.match(result.error, /32 nested frames/);
  assert.equal(result.events.at(-1).callStack.length, 33);
  for (const source of [
    "eval('1')",
    "Function('return 1')()",
    "fetch('https://example.test')",
    "const f = async () => 1;",
  ]) {
    assert.match(
      traceJavaScript(source).error,
      /Unsupported JavaScript syntax/,
    );
  }
});
