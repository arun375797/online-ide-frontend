import {
  createExecutionLesson,
  learningStepIndices,
  lessonValue,
  prepareLessonSource,
  readSnapshotExpression,
} from "./executionLesson.js";

const same = (a, b) =>
  Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
const frames = (step) =>
  step?.callStack || [
    { id: 0, name: "Global", variables: step?.variables || {} },
  ];

function rootChanges(step, previous) {
  const result = [];
  for (const frame of frames(step)) {
    const before =
      frames(previous).find((old) => old.id === frame.id)?.variables || {};
    const after = frame.variables || {};
    for (const name of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      if ((after[name] || before[name]).type === "function") continue;
      if (
        Object.hasOwn(before, name) === Object.hasOwn(after, name) &&
        same(before[name]?.value, after[name]?.value)
      )
        continue;
      result.push({
        name,
        scope: frame.name,
        frameId: frame.id,
        existed: Object.hasOwn(before, name),
        exists: Object.hasOwn(after, name),
        before: before[name]?.value,
        after: after[name]?.value,
      });
    }
  }
  return result;
}

function spliceChange(context, step, previous, roots) {
  for (const { node } of context.nodes) {
    if (
      node.type !== "CallExpression" ||
      node.loc.start.line !== step.line ||
      node.callee.type !== "MemberExpression"
    )
      continue;
    const callee = node.callee;
    if (
      (callee.computed ? callee.property.value : callee.property.name) !==
        "splice" ||
      callee.object.type !== "Identifier"
    )
      continue;
    const change = roots.find(
      (item) =>
        item.name === callee.object.name &&
        Array.isArray(item.before) &&
        Array.isArray(item.after),
    );
    if (!change || !node.arguments.length) continue;
    const args = node.arguments.map((arg) =>
      readSnapshotExpression(arg, previous?.variables || {}),
    );
    if (
      args.some((arg) => !arg.known) ||
      typeof args[0].value !== "number" ||
      (args.length > 1 && typeof args[1].value !== "number")
    )
      continue;
    const length = change.before.length;
    const rawStart = Math.trunc(args[0].value) || 0;
    const start =
      rawStart < 0
        ? Math.max(0, length + rawStart)
        : Math.min(length, rawStart);
    const count =
      args.length === 1
        ? length - start
        : Math.min(length - start, Math.max(0, Math.trunc(args[1].value) || 0));
    const inserted = args.slice(2).map((arg) => arg.value);
    // Validate against actual snapshots; never execute a user's method to explain it.
    const expected = [
      ...change.before.slice(0, start),
      ...inserted,
      ...change.before.slice(start + count),
    ];
    if (!same(expected, change.after)) continue;
    return {
      name: change.name,
      start,
      count,
      inserted,
      removed: change.before.slice(start, start + count),
      moves: change.before.flatMap((_, index) =>
        index >= start + count && count !== inserted.length
          ? [{ from: index, to: index - count + inserted.length }]
          : [],
      ),
      pointerName:
        node.arguments[0].type === "Identifier" ? node.arguments[0].name : null,
    };
  }
  return null;
}

function arrayViews(context, step, previous, roots, splice) {
  const result = roots
    .filter((change) => Array.isArray(change.after))
    .map((change) => ({
      ...change,
      changed: true,
      splice: splice?.name === change.name ? splice : null,
    }));
  // Also show which element a decision reads, even when no value changes.
  if (step.condition) {
    for (const { node } of context.nodes) {
      if (
        node.type !== "MemberExpression" ||
        node.loc.start.line !== step.line ||
        node.object.type !== "Identifier"
      )
        continue;
      const name = node.object.name;
      const value = step.variables?.[name]?.value;
      if (!Array.isArray(value)) continue;
      let view = result.find((item) => item.name === name);
      if (!view) {
        view = {
          name,
          before: value,
          after: value,
          existed: true,
          exists: true,
          changed: false,
        };
        result.push(view);
      }
      if (node.computed) {
        const index = readSnapshotExpression(node.property, step.variables);
        if (index.known && Number.isInteger(index.value)) {
          view.pointer = index.value;
          view.pointerName = context.source.slice(
            node.property.start,
            node.property.end,
          );
        }
      }
    }
  }
  for (const view of result) {
    if (view.splice) {
      view.pointer = splice.start;
      view.pointerName = splice.pointerName;
    }
  }
  return result;
}

/** Cards are derived once from immutable recorded events. Advancing reveals a prefix. */
export function buildExecutionHistory(trace, source, indices) {
  const events = trace?.events || [];
  const context = prepareLessonSource(source);
  const selected = indices || learningStepIndices(events);
  const cards = [];
  for (const index of selected) {
    const step = events[index];
    if (!step) continue;
    const previous = events[index - 1];
    const lesson = createExecutionLesson(context, step, previous);
    const roots = rootChanges(step, previous);
    const splice = spliceChange(context, step, previous, roots);
    const card = {
      index,
      number: cards.length + 1,
      line: step.line,
      kind: lesson.kind,
      title: lesson.title,
      explanation: lesson.explanation || "Continue with the next instruction.",
      code: lesson.code,
      substitution: lesson.substitution,
      result: lesson.result,
      inputs: lesson.inputs || [],
      changes: roots,
      arrays: arrayViews(context, step, previous, roots, splice),
      string: lesson.string,
      splice,
      output: (trace.output || []).slice(
        previous?.output || 0,
        step.output || 0,
      ),
      scope: step.callStack?.at(-1)?.name || "Global",
      iteration: step.condition ? null : step.loops?.at(-1)?.iteration,
      snapshot: step.variables || {},
    };
    if (splice) {
      card.kind = "change";
      card.code =
        context.nodes.find(
          ({ node }) =>
            node.type === "CallExpression" &&
            node.loc.start.line === step.line &&
            node.callee.object?.name === splice.name &&
            node.callee.property?.name === "splice",
        )?.text || card.code;
      card.title =
        splice.count && !splice.inserted.length
          ? splice.count === 1
            ? `Remove ${lessonValue(splice.removed[0], 22)} from ${splice.name} at index ${splice.start}`
            : `Remove ${splice.count} items from ${splice.name}`
          : `Change ${splice.name} at index ${splice.start}`;
      card.explanation = `Start at index ${splice.start}. Remove ${splice.count} ${splice.count === 1 ? "item" : "items"}${splice.inserted.length ? ` and insert ${splice.inserted.length}` : ""}. ${splice.moves.length ? `The items after it shift ${splice.count > splice.inserted.length ? "left" : "right"} to fill the new positions.` : "The other items keep their positions."} This changes the original array.`;
      card.substitution = null;
    }
    if (card.kind === "condition" && !card.title.startsWith("The loop")) {
      const read = card.arrays.find(
        (view) =>
          Number.isInteger(view.pointer) &&
          Object.hasOwn(view.after, view.pointer) &&
          (view.after[view.pointer] === null ||
            typeof view.after[view.pointer] !== "object"),
      );
      if (read) {
        card.title = `Check ${read.name}[${read.pointer}]`;
        card.explanation = `The value at index ${read.pointer} is ${JSON.stringify(read.after[read.pointer])}. ${card.explanation}`;
      }
    }
    const last = cards.findLast(
      (item) =>
        item.splice ||
        item.changes.length ||
        ["condition", "call", "return", "output"].includes(item.kind),
    );
    const decrement = roots.find(
      (change) =>
        change.name === last?.splice?.pointerName &&
        typeof change.before === "number" &&
        change.after === change.before - 1,
    );
    const loop =
      decrement &&
      context.nodes.find(
        ({ node }) =>
          node.type === "ForStatement" &&
          node.loc.start.line <= step.line &&
          node.loc.end.line >= step.line &&
          node.update?.type === "UpdateExpression" &&
          node.update.operator === "++" &&
          node.update.argument.name === decrement.name,
      );
    if (
      last?.splice?.count > last?.splice?.inserted.length &&
      decrement &&
      loop &&
      last.splice.start === decrement.before
    ) {
      card.title = `Move ${decrement.name} back so no item is skipped`;
      card.explanation = `${decrement.name} goes from ${decrement.before} to ${decrement.after}. The loop's ${decrement.name}++ will bring it back to ${decrement.before}, so the item that shifted into index ${decrement.before} is checked next.`;
      card.recheck = {
        name: decrement.name,
        before: decrement.before,
        after: decrement.after,
        next: decrement.before,
      };
    }
    if (step.type === "before") {
      card.kind = "before";
      card.title = "About to run this line";
      card.code = source.split("\n")[step.line - 1]?.trim();
      card.explanation =
        "The values have not changed yet. The following step records what this instruction does.";
    }
    if (step.type === "complete") {
      card.explanation =
        "All instructions have run. The earlier steps stay above so you can trace how the result was reached.";
      card.code = null;
      card.arrays = Object.entries(step.variables || {})
        .filter(([, entry]) => Array.isArray(entry.value))
        .map(([name, entry]) => ({ name, after: entry.value, changed: false }));
    }
    // A native statement can print without its own output event (e.g. timers).
    if (card.output.length) {
      card.kind = "output";
      card.title = "Print to the output";
      card.substitution = null;
      if (step.type === "output")
        card.explanation =
          "console.log prints the current value below. It does not change the array or variable.";
    }
    cards.push(card);
  }
  return cards;
}

export function historyThrough(cards, activeStep) {
  return cards.filter((card) => card.index <= activeStep);
}
