import test from "node:test";
import assert from "node:assert/strict";
import { traceNativeJavaScript } from "./nativeVisualizer.js";
import { traceProgram } from "./traceProgram.js";

test("executes the exact string-removal example with intermediate values", async () => {
  const result = await traceProgram(`let str = "hello world javascript";
for (let i = 0; i < str.length; i++) {
  if (str[i] === " ") {
    str = str.replace(" ", "");
    i--;
  }
}
console.log(str);`);
  assert.equal(result.error, "");
  assert.deepEqual(result.output, ["helloworldjavascript"]);
  assert.equal(result.engine, "javascript");
  const values = result.events.map((event) => event.variables.str?.value);
  assert.ok(values.includes("helloworld javascript"));
  assert.equal(
    result.events.at(-1).variables.str.value,
    "helloworldjavascript",
  );
  assert.ok(result.events.some((event) => event.variables.i?.value === 5));
  assert.doesNotThrow(() => structuredClone(result));
});

test("supports objects, destructuring, spread, templates, optional chaining, and array callbacks", async () => {
  const result =
    await traceProgram(`const person = { name: "Ana", scores: [1, 2, 3] };
const { name, ...rest } = person;
const sum = rest.scores.map(n => n * 2).filter(n => n > 2).reduce((a, b) => a + b, 0);
console.log(name, sum, person.address?.city ?? "unknown");
console.log(\`count: \${[...rest.scores].length}\`);`);
  assert.equal(result.error, "");
  assert.deepEqual(result.output, ["Ana 10 unknown", "count: 3"]);
  assert.deepEqual(result.events.at(-1).variables.person.value, {
    name: "Ana",
    scores: [1, 2, 3],
  });
});

test("supports classes, private fields, inheritance, getters, and native methods", async () => {
  const result = await traceProgram(`class Base {
  #offset = 2;
  constructor(value) { this.value = value; }
  get total() { return this.value + this.#offset; }
}
class Child extends Base { constructor() { super(3); } }
const instance = new Child();
console.log(instance.total, " HELLO ".trim().toLowerCase(), Math.max(3, 7));`);
  assert.equal(result.error, "");
  assert.deepEqual(result.output, ["5 hello 7"]);
});

test("executes while, do/while, for/of, for/in, switch, break, continue, and exceptions", async () => {
  const result = await traceProgram(`let total = 0;
for (const value of [1, 2, 3]) { if (value === 2) continue; total += value; }
let count = 2;
while (count--) total++;
do { total--; } while (false);
for (const key in { a: 1 }) { console.log(key); break; }
switch (total) { case 5: console.log(total); break; default: console.log("bad"); }
try { throw new Error("caught"); } catch (error) { console.log(error.message); } finally { console.log("done"); }`);
  assert.equal(result.error, "");
  assert.deepEqual(result.output, ["a", "5", "caught", "done"]);
});

test("runs async/await, promise callbacks, microtasks, and virtual timers in order", async () => {
  const result =
    await traceProgram(`async function compute() { const value = await Promise.resolve(3); console.log(value); return value + 1; }
compute().then(value => console.log(value));
setTimeout(() => console.log("later"), 500);
setTimeout(() => console.log("first timer"), 10);
console.log("sync");`);
  assert.equal(result.error, "");
  assert.deepEqual(result.output, ["sync", "3", "4", "first timer", "later"]);
  const interval = await traceNativeJavaScript(
    "let count=0; const id=setInterval(()=>{console.log(++count); if(count===2)clearInterval(id);},5);",
  );
  assert.deepEqual(interval.output, ["1", "2"]);
});

test("handles rejected promises and top-level await without false success", async () => {
  const rejected = await traceNativeJavaScript(
    "async function fail(){ throw new Error('oops'); } fail();",
  );
  assert.match(rejected.error, /Unhandled promise rejection.*oops/);
  const caught = await traceNativeJavaScript(
    "async function run(){ try { await Promise.reject('handled'); } catch(error) { console.log(error); } } run();",
  );
  assert.equal(caught.error, "");
  assert.deepEqual(caught.output, ["handled"]);
  const all = await traceNativeJavaScript(
    "Promise.all([Promise.reject('handled all')]).catch(error=>console.log(error));",
  );
  assert.equal(all.error, "");
  const module = await traceProgram(
    "export const answer = await Promise.resolve(42); console.log(answer);",
  );
  assert.equal(module.error, "");
  assert.deepEqual(module.output, ["42"]);
});

test("supports generators, Map, Set, BigInt, RegExp, and locally evaluated JavaScript", async () => {
  const result = await traceProgram(`function* values() { yield 1; yield 2; }
const map = new Map([['a', 4]]);
const set = new Set([1, 1, 2]);
console.log([...values()].join(','), map.get('a'), set.size, 3n + 4n);
console.log('a1 b2'.replace(/\\d/g, '!'));
const local = 4;
console.log(eval('local + 2'), Function('return 5')());`);
  assert.equal(result.error, "");
  assert.deepEqual(result.output, ["1,2 4 2 7n", "a! b!", "6 5"]);
});

test("preserves native scoping and directives instead of subset-interpreter behavior", async () => {
  const result = await traceProgram(`"use strict";
{ var shared = 3; }
function receiver() { "use strict"; return this; }
console.log(shared, receiver(), typeof undeclared);
const choose = (value = 4) => value ** 2;
console.log(choose());`);
  assert.equal(result.error, "");
  assert.deepEqual(result.output, ["3 undefined undefined", "16"]);
});

test("snapshots don't invoke property getters and circular values stay cloneable", async () => {
  const result = await traceProgram(`let reads=0;
const object={get value(){reads++;return 4;}};
const circular={};circular.self=circular;
console.log(reads);`);
  assert.equal(result.error, "");
  assert.deepEqual(result.output, ["0"]);
  assert.doesNotThrow(() => structuredClone(result));
  assert.equal(
    result.events.at(-1).variables.circular.value.self,
    "[Circular]",
  );
});

test("retains precise matrix operand diagrams when they agree with native execution", async () => {
  const result = await traceProgram(
    "const A=[[2]];const B=[[3]];const result=[[]];result[0][0]=A[0][0]+B[0][0];console.log(result);",
  );
  assert.equal(result.error, "");
  assert.equal(result.engine, "detailed");
  assert.deepEqual(
    result.events.find((event) => event.write?.path.length === 2).calculation,
    { left: 2, right: 3, operator: "+", value: 5 },
  );
});

test("runtime failures are shown and host APIs remain outside the VM", async () => {
  const isolated = await traceNativeJavaScript(
    "console.log(typeof document, typeof process, Function('return typeof fetch')());",
  );
  assert.deepEqual(isolated.output, ["undefined undefined undefined"]);
  const unavailable = await traceProgram("document.createElement('div');");
  assert.match(unavailable.error, /not browser DOM/);
  const error = await traceProgram("const value={};\nvalue.missing();");
  assert.ok(error.error);
  assert.equal(error.events.at(-1).line, 2);
  await assert.rejects(traceProgram("let broken = ;"), /Syntax error/);
});

test("stops excessive loops, dynamically generated infinite code, and output floods", async () => {
  const loop = await traceNativeJavaScript("while(true) {}", { maxSteps: 30 });
  assert.match(loop.error, /limit/);
  const generated = await traceNativeJavaScript("eval('while(true) {}');", {
    timeoutMs: 30,
  });
  assert.match(generated.error, /time limit/);
  const output = await traceNativeJavaScript(
    "for(let i=0;i<300;i++)console.log(i);",
    { maxSteps: 2000 },
  );
  assert.match(output.error, /output limit/);
  assert.equal(output.output.length, 250);
});
