import test from "node:test";
import assert from "node:assert/strict";
import { traceProgram } from "./traceProgram.js";
import { buildExecutionHistory, historyThrough } from "./executionHistory.js";

const source = `let arr = [1, 0, 2, 0, 3, 0, 0, 4, 5];

for (let i = 0; i < arr.length; i++) {
  if (arr[i] === 0) {
    arr.splice(i, 1);
    i--;
  }
}
console.log(arr);`;

test("advancing appends cards and preserves all past values; rewinding hides future cards", async () => {
  const trace = await traceProgram(source);
  const cards = buildExecutionHistory(trace, source);
  let previous = [];
  for (const card of cards) {
    const shown = historyThrough(cards, card.index);
    assert.deepEqual(shown.slice(0, -1), previous);
    if (previous.length) assert.strictEqual(shown[0], previous[0]);
    previous = shown;
  }
  assert.deepEqual(cards[0].arrays[0].after, [1, 0, 2, 0, 3, 0, 0, 4, 5]);
  assert.deepEqual(cards.at(-1).arrays[0].after, [1, 2, 3, 4, 5]);
  const removals = cards.filter((card) => card.splice);
  const rewind = historyThrough(cards, removals[1].index);
  assert.equal(rewind.filter((card) => card.splice).length, 2);
  assert.equal(rewind.flatMap((card) => card.output).length, 0);
  assert.deepEqual(
    historyThrough(cards, removals[1].index),
    rewind,
    "replay must not duplicate cards",
  );
});

test("the user's four zero removals retain exact before/after indexes and shift arrows", async () => {
  const trace = await traceProgram(source);
  const cards = buildExecutionHistory(trace, source);
  const removals = cards.filter((card) => card.splice);
  assert.equal(removals.length, 4);
  assert.deepEqual(
    removals.map((card) => card.splice.start),
    [1, 2, 3, 3],
  );
  assert.deepEqual(
    removals.map((card) => card.arrays[0].after.length),
    [8, 7, 6, 5],
  );
  for (const card of removals) {
    const view = card.arrays[0];
    assert.deepEqual(card.splice.removed, [0]);
    assert.equal(card.splice.count, 1);
    assert.match(card.explanation, /shift left.*original array/);
    for (const move of card.splice.moves) {
      assert.equal(view.before[move.from], view.after[move.to]);
      assert.equal(move.to, move.from - 1);
    }
  }
  assert.deepEqual(
    removals[2].arrays[0].after,
    removals[3].arrays[0].before,
    "consecutive zeros must stay distinguishable",
  );
  assert.deepEqual(trace.output, ["[1, 2, 3, 4, 5]"]);
});

test("both detail modes explain i--, the upcoming i++, and the repeated index", async () => {
  const trace = await traceProgram(source);
  for (const indices of [undefined, trace.events.map((_, index) => index)]) {
    const cards = buildExecutionHistory(trace, source, indices);
    const rechecks = cards.filter((card) => card.recheck);
    assert.equal(rechecks.length, 4);
    for (const card of rechecks) {
      assert.equal(card.recheck.after, card.recheck.before - 1);
      assert.equal(card.recheck.next, card.recheck.before);
      assert.match(
        card.explanation,
        /loop's i\+\+.*shifted into index.*checked next/,
      );
      assert.equal(card.code, "i--");
    }
  }
});

test("condition cards locate the observed item and output appears at its actual execution step", async () => {
  const trace = await traceProgram(source);
  const cards = buildExecutionHistory(trace, source);
  const checks = cards.filter(
    (card) => card.line === 4 && card.kind === "condition",
  );
  assert.equal(checks.length, 9);
  assert.equal(checks[0].title, "Check arr[0]");
  assert.equal(checks[0].substitution, "1 === 0");
  assert.equal(checks[0].result, false);
  assert.equal(checks[1].arrays[0].pointer, 1);
  assert.equal(checks[1].substitution, "0 === 0");
  assert.equal(checks[1].result, true);
  const printed = cards.find((card) => card.output.length);
  assert.equal(
    historyThrough(cards, printed.index - 1).some((card) => card.output.length),
    false,
  );
  assert.deepEqual(printed.output, trace.output);
  assert.equal(printed.line, 9);
  const stop = cards.find((card) => card.title === "The loop stops");
  assert.equal(stop.substitution, "5 < 5");
  assert.ok(stop.index < printed.index);
});

test("splice explanations handle negative indexes and insertion without inventing removed items", async () => {
  const code =
    "let arr = [1,2,3,4];\narr.splice(-2, 1, 8, 9);\nconsole.log(arr);";
  const trace = await traceProgram(code);
  const card = buildExecutionHistory(trace, code).find((item) => item.splice);
  assert.equal(card.splice.start, 2);
  assert.deepEqual(card.splice.removed, [3]);
  assert.deepEqual(card.splice.inserted, [8, 9]);
  assert.deepEqual(card.splice.moves, [{ from: 3, to: 4 }]);
  assert.deepEqual(card.arrays[0].after, [1, 2, 8, 9, 4]);
  assert.match(card.explanation, /shift right/);
});

test("building and reviewing history never repeats a user call or guesses unknown arguments", async () => {
  const code =
    "let calls = 0;\nlet arr = [1,0,2];\nfunction position() { calls++; return 1; }\narr.splice(position(),1);\nconsole.log(calls);";
  const trace = await traceProgram(code);
  const frozen = JSON.stringify(trace);
  for (let i = 0; i < 3; i++) {
    const cards = buildExecutionHistory(trace, code);
    assert.ok(
      cards.some((card) =>
        card.arrays.some(
          (view) => view.before?.length === 3 && view.after?.length === 2,
        ),
      ),
    );
    assert.ok(
      cards.every((card) => !card.splice),
      "a side-effecting argument cannot be resolved from snapshots",
    );
  }
  assert.equal(JSON.stringify(trace), frozen);
  assert.deepEqual(trace.output, ["1"]);
});

test("matrix changes and separate function scopes retain earlier snapshots", async () => {
  const code =
    "const sum = [[0,0],[0,0]];\nsum[0][0] = 4 + 7;\nsum[0][1] = 8 + 14;\nfunction twice(x) { let total = x * 2; return total; }\nlet total = twice(3);\nconsole.log(sum, total);";
  const trace = await traceProgram(code);
  const cards = buildExecutionHistory(trace, code);
  const matrix = cards.filter((card) =>
    card.arrays.some((view) => view.name === "sum"),
  );
  assert.deepEqual(matrix[0].arrays[0].after, [
    [0, 0],
    [0, 0],
  ]);
  assert.deepEqual(matrix[1].arrays[0].before, [
    [0, 0],
    [0, 0],
  ]);
  assert.deepEqual(matrix[1].arrays[0].after, [
    [11, 0],
    [0, 0],
  ]);
  assert.ok(
    cards.some((card) =>
      card.changes.some(
        (change) =>
          change.name === "total" &&
          change.scope === "twice" &&
          change.after === 6,
      ),
    ),
  );
  assert.ok(
    cards.some((card) =>
      card.changes.some(
        (change) =>
          change.name === "total" &&
          change.scope === "Global" &&
          change.after === 6,
      ),
    ),
  );
});
