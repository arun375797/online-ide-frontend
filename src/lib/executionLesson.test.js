import test from "node:test";
import assert from "node:assert/strict";
import { traceProgram } from "./traceProgram.js";
import {
  createExecutionLesson,
  learningStepIndices,
  prepareLessonSource,
  variableChanges,
} from "./executionLesson.js";

const stringSource = `let str = "hello world javascript";
for (let i = 0; i < str.length; i++) {
  if (str[i] === " ") {
    str = str.replace(" ", "");
    i--;
  }
}
console.log(str);`;

test("guided steps retain real changes, decisions, and output while skipping bookkeeping", async () => {
  const trace = await traceProgram(stringSource);
  const indices = learningStepIndices(trace.events);
  assert.ok(indices.length < trace.events.length * 0.6);
  assert.ok(indices.every((index) => trace.events[index].type !== "before"));
  assert.ok(
    indices.includes(
      trace.events.findIndex((event) => event.type === "output"),
    ),
  );
  assert.ok(
    indices.includes(
      trace.events.findIndex(
        (event) => event.condition === "i < str.length" && !event.result,
      ),
    ),
  );
  assert.ok(indices.includes(trace.events.length - 1));
  const withBreakpoints = learningStepIndices(trace.events, [4]);
  assert.ok(
    withBreakpoints.some(
      (index) =>
        trace.events[index].line === 4 && trace.events[index].type === "before",
    ),
  );
  assert.deepEqual(trace.output, ["helloworldjavascript"]);
});

test("string walkthrough identifies the removed space and shows actual before/after values", async () => {
  const trace = await traceProgram(stringSource);
  const context = prepareLessonSource(stringSource);
  const index = trace.events.findIndex(
    (step, position) =>
      step.variables.str?.value === "helloworld javascript" &&
      trace.events[position - 1]?.variables.str?.value ===
        "hello world javascript",
  );
  const lesson = createExecutionLesson(
    context,
    trace.events[index],
    trace.events[index - 1],
    trace.events[index + 1],
  );
  assert.equal(lesson.title, "Remove the first space from str");
  assert.equal(lesson.string.removedIndex, 5);
  assert.equal(lesson.string.index, 5);
  assert.equal(lesson.string.before, "hello world javascript");
  assert.equal(lesson.string.after, "helloworld javascript");
  assert.equal(lesson.primary.before, lesson.string.before);
  assert.equal(lesson.primary.after, lesson.string.after);
});

test("the backward index step explains its purpose and retains the string visualization", async () => {
  const trace = await traceProgram(stringSource);
  const context = prepareLessonSource(stringSource);
  const index = trace.events.findIndex(
    (step, position) =>
      step.line === 5 &&
      step.variables.i?.value === 4 &&
      trace.events[position - 1]?.variables.i?.value === 5,
  );
  const lesson = createExecutionLesson(
    context,
    trace.events[index],
    trace.events[index - 1],
  );
  assert.equal(lesson.code, "i--");
  assert.equal(lesson.substitution, "5 − 1 = 4");
  assert.match(lesson.explanation, /shifted left is checked next/);
  assert.equal(lesson.string.beforeIndex, 5);
  assert.equal(lesson.string.index, 4);
  assert.equal(lesson.string.changed, false);
});

test("conditions use observed values and distinguish continuing, skipping, and exiting", async () => {
  const trace = await traceProgram(stringSource);
  const context = prepareLessonSource(stringSource);
  const index = trace.events.findIndex(
    (step) => step.condition === 'str[i] === " "' && step.result,
  );
  const check = createExecutionLesson(
    context,
    trace.events[index],
    trace.events[index - 1],
  );
  assert.equal(check.substitution, '" " === " "');
  assert.match(check.explanation, /character is a space.*Run the if block/);
  assert.ok(check.string);
  const endIndex = trace.events.findIndex(
    (step) => step.condition === "i < str.length" && !step.result,
  );
  const indices = learningStepIndices(trace.events);
  const nextIndex = indices[indices.indexOf(endIndex) + 1];
  const end = createExecutionLesson(
    context,
    trace.events[endIndex],
    trace.events[endIndex - 1],
    trace.events[nextIndex],
  );
  assert.equal(end.title, "The loop stops");
  assert.equal(end.substitution, "20 < 20");
  assert.equal(
    end.nextLine,
    8,
    "the next real instruction is console.log, not scope cleanup on the loop header",
  );
});

test("arithmetic explanations use old values and scope changes do not alter global values", async () => {
  const source = "let total=2;\nlet value=3;\ntotal += value;";
  const trace = await traceProgram(source);
  const context = prepareLessonSource(source);
  const index = trace.events.findIndex(
    (step) => step.changed === "total" && step.type === "assignment",
  );
  const lesson = createExecutionLesson(
    context,
    trace.events[index],
    trace.events[index - 1],
  );
  assert.equal(lesson.substitution, "2 + 3 = 5");
  assert.equal(lesson.primary.before, 2);
  assert.equal(lesson.primary.after, 5);
  const scoped = await traceProgram(
    "let value=4;function f(value){value++;return value;}f(7);",
  );
  const updateIndex = scoped.events.findIndex(
    (step) => step.type === "assignment" && step.changed === "value",
  );
  const changes = variableChanges(
    scoped.events[updateIndex],
    scoped.events[updateIndex - 1],
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].scope, "f");
  assert.equal(changes[0].before, 7);
  assert.equal(changes[0].after, 8);
});

test("matrix explanations identify the exact changed cell and both read operands", async () => {
  const source =
    "const A=[[2]];\nconst B=[[3]];\nconst result=[[]];\nresult[0][0]=A[0][0]+B[0][0];";
  const trace = await traceProgram(source);
  const index = trace.events.findIndex((step) => step.write?.path.length === 2);
  const lesson = createExecutionLesson(
    prepareLessonSource(source),
    trace.events[index],
    trace.events[index - 1],
  );
  assert.equal(lesson.primary.label, "result[0][0]");
  assert.equal(lesson.primary.after, 5);
  assert.equal(lesson.substitution, "2 + 3 → 5");
  assert.deepEqual(
    lesson.reads.map((read) => read.name),
    ["A", "B"],
  );
});

test("the guide never re-executes calls or invents intermediate values for side effects", async () => {
  const source = "let i=0;\nif(i++ < 2){console.log(i);} ";
  const trace = await traceProgram(source);
  const index = trace.events.findIndex((step) => step.condition);
  const lesson = createExecutionLesson(
    prepareLessonSource(source),
    trace.events[index],
    trace.events[index - 1],
  );
  assert.equal(lesson.result, true);
  assert.equal(lesson.substitution, null);
  assert.deepEqual(trace.output, ["1"]);
});
