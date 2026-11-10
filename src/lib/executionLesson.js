import { parse } from "acorn";

const UNKNOWN = Symbol("unknown snapshot value");
const same = (left, right) =>
  Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
export function lessonValue(value, max = 56) {
  let text =
    typeof value === "string"
      ? JSON.stringify(value)
      : value && typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function prepareLessonSource(source) {
  let ast;
  try {
    ast = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      allowHashBang: true,
    });
  } catch {
    return { source, nodes: [] };
  }
  const nodes = [];
  function visit(node, parent = null) {
    if (!node?.type) return;
    nodes.push({ node, parent, text: source.slice(node.start, node.end) });
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue;
      if (Array.isArray(value))
        value.forEach((child) => {
          if (child?.type) visit(child, node);
        });
      else if (value?.type) visit(value, node);
    }
  }
  visit(ast);
  return { source, nodes };
}

export function variableChanges(step, previous) {
  const frames = step?.callStack || [
    { id: 0, name: "Global", variables: step?.variables || {} },
  ];
  const oldFrames = previous?.callStack || [
    { id: 0, variables: previous?.variables || {} },
  ];
  const changes = [];
  function add(
    name,
    before,
    after,
    existed,
    exists,
    frame,
    path = [],
    depth = 0,
  ) {
    if (changes.length >= 24) return;
    if (existed && exists && same(before, after)) return;
    if (
      existed &&
      exists &&
      depth < 3 &&
      before &&
      after &&
      typeof before === "object" &&
      typeof after === "object" &&
      Array.isArray(before) === Array.isArray(after)
    ) {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const key of keys)
        add(
          name,
          before[key],
          after[key],
          Object.hasOwn(before, key),
          Object.hasOwn(after, key),
          frame,
          [...path, Array.isArray(after) ? Number(key) : key],
          depth + 1,
        );
      if (Array.isArray(after) && before.length !== after.length)
        add(
          name,
          before.length,
          after.length,
          true,
          true,
          frame,
          [...path, "length"],
          3,
        );
      return;
    }
    const label =
      name +
      path
        .map((key) => (typeof key === "number" ? `[${key}]` : `.${key}`))
        .join("");
    changes.push({
      name,
      label,
      path,
      before,
      after,
      existed,
      exists,
      scope: frame.name,
      frameId: frame.id,
      kind: !exists ? "removed" : !existed ? "created" : "updated",
    });
  }
  for (const frame of frames) {
    const old = oldFrames.find((item) => item.id === frame.id)?.variables || {};
    for (const [name, entry] of Object.entries(frame.variables || {})) {
      if (entry.type === "function") continue;
      add(
        name,
        old[name]?.value,
        entry.value,
        Object.hasOwn(old, name),
        true,
        frame,
      );
    }
    for (const [name, entry] of Object.entries(old)) {
      if (
        entry.type !== "function" &&
        !Object.hasOwn(frame.variables || {}, name)
      )
        add(name, entry.value, undefined, true, false, frame);
    }
  }
  return changes;
}

function snapshotValue(node, variables) {
  if (!node) return UNKNOWN;
  if (node.type === "Literal") return node.value;
  if (node.type === "Identifier") {
    const entry = variables[node.name];
    if (node.name === "undefined" && !entry) return undefined;
    if (
      !entry ||
      entry.type === "function" ||
      entry.type === "symbol" ||
      entry.type === "bigint" ||
      (entry.type === "object" && typeof entry.value === "string")
    )
      return UNKNOWN;
    return entry.value;
  }
  if (node.type === "MemberExpression") {
    const target = snapshotValue(node.object, variables);
    const key = node.computed
      ? snapshotValue(node.property, variables)
      : node.property.name;
    if (target === UNKNOWN || key === UNKNOWN || target == null) return UNKNOWN;
    if (typeof target !== "string" && typeof target !== "object")
      return UNKNOWN;
    if (
      key === "length" &&
      (typeof target === "string" || Array.isArray(target))
    )
      return target.length;
    if (!Object.hasOwn(Object(target), key)) return UNKNOWN;
    const value = target[key];
    return value === "[Getter/Setter]" ||
      value === "[Circular]" ||
      (typeof value === "string" && value.startsWith("[Function "))
      ? UNKNOWN
      : value;
  }
  if (node.type === "UnaryExpression") {
    const value = snapshotValue(node.argument, variables);
    if (value === UNKNOWN || typeof value === "object") return UNKNOWN;
    if (node.operator === "!") return !value;
    if (node.operator === "-") return -value;
    if (node.operator === "+") return +value;
    if (node.operator === "typeof") return typeof value;
  }
  if (node.type === "BinaryExpression") {
    const left = snapshotValue(node.left, variables);
    const right = snapshotValue(node.right, variables);
    if (
      left === UNKNOWN ||
      right === UNKNOWN ||
      (left && typeof left === "object") ||
      (right && typeof right === "object")
    )
      return UNKNOWN;
    try {
      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        case "%":
          return left % right;
        case "**":
          return left ** right;
        case "<":
          return left < right;
        case "<=":
          return left <= right;
        case ">":
          return left > right;
        case ">=":
          return left >= right;
        case "===":
          return left === right;
        case "!==":
          return left !== right;
        case "==":
          return left == right;
        case "!=":
          return left != right;
      }
    } catch {
      return UNKNOWN;
    }
  }
  return UNKNOWN;
}

// Read recorded values only. Calls and accessors are deliberately not evaluated.
export function readSnapshotExpression(node, variables) {
  const value = snapshotValue(node, variables);
  return value === UNKNOWN ? { known: false } : { known: true, value };
}

function substituted(node, variables, context) {
  if (node.type === "BinaryExpression") {
    const left = snapshotValue(node.left, variables);
    const right = snapshotValue(node.right, variables);
    if (
      left !== UNKNOWN &&
      right !== UNKNOWN &&
      !(left && typeof left === "object") &&
      !(right && typeof right === "object")
    )
      return `${lessonValue(left, 28)} ${node.operator} ${lessonValue(right, 28)}`;
  }
  const value = snapshotValue(node, variables);
  return value === UNKNOWN ? null : lessonValue(value);
}

function expressionInputs(node, variables, context, result = []) {
  if (!node || result.length >= 3) return result;
  if (node.type === "Identifier" || node.type === "MemberExpression") {
    const value = snapshotValue(node, variables);
    if (value !== UNKNOWN && !(value && typeof value === "object")) {
      const name = context.source.slice(node.start, node.end);
      if (!result.some((item) => item.name === name))
        result.push({ name, value });
    }
    if (node.type === "MemberExpression" && node.computed)
      expressionInputs(node.property, variables, context, result);
  } else {
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue;
      if (value?.type) expressionInputs(value, variables, context, result);
    }
  }
  return result;
}

function pickNode(context, step, change) {
  const candidates = context.nodes.filter(
    ({ node }) => node.loc.start.line === step.line,
  );
  if (step.condition)
    return context.nodes.find(
      ({ text, node }) =>
        text === step.condition && node.loc.start.line === step.line,
    )?.node;
  if (change) {
    const rootName = (node) =>
      node?.type === "MemberExpression" ? rootName(node.object) : node?.name;
    const targets = candidates.filter(
      ({ node }) =>
        (node.type === "AssignmentExpression" &&
          rootName(node.left) === change.name) ||
        (node.type === "UpdateExpression" &&
          rootName(node.argument) === change.name),
    );
    const exact = targets.find(
      ({ node }) =>
        (step.column > 0 || step.changed !== undefined) &&
        node.loc.start.column === step.column,
    );
    if (exact) return exact.node;
    const matchingUpdate = targets.filter(
      ({ node }) =>
        node.type === "UpdateExpression" &&
        typeof change.before === "number" &&
        (node.operator === "++" ? change.before + 1 : change.before - 1) ===
          change.after,
    );
    if (matchingUpdate.length === 1) return matchingUpdate[0].node;
    if (targets.length === 1) return targets[0].node;
    const declaration = candidates.find(
      ({ node }) =>
        node.type === "VariableDeclarator" && node.id.name === change.name,
    );
    if (declaration) return declaration.node;
  }
  return candidates.find(
    ({ node }) =>
      node.type === "ReturnStatement" || node.type === "CallExpression",
  )?.node;
}

export function learningStepIndices(events, breakpoints = []) {
  const indices = [];
  for (let index = 0; index < events.length; index++) {
    const step = events[index];
    if (breakpoints.includes(step.line)) {
      indices.push(index);
      continue;
    }
    if (step.type === "before") continue;
    const changes = variableChanges(step, events[index - 1]);
    const last = events[indices.at(-1)];
    if (
      step.type === "loop" &&
      last?.condition &&
      last.result &&
      last.line === step.line &&
      same(step.variables, last.variables)
    )
      continue;
    if (
      ["statement", "expression"].includes(step.type) &&
      !changes.some((change) => change.kind !== "removed") &&
      step.output === (events[index - 1]?.output || 0)
    )
      continue;
    if (
      step.type === "call-result" &&
      last?.type === "return" &&
      !changes.length
    )
      continue;
    indices.push(index);
  }
  return indices.length ? indices : events.length ? [0] : [];
}

function createLessonBase(context, step, previous, next) {
  if (!step)
    return {
      kind: "ready",
      title: "Let's follow your code together",
      explanation:
        "Run a program, then use Next to follow one change at a time.",
      changes: [],
      reads: [],
    };
  const changes = variableChanges(step, previous);
  const activeChanges = changes.filter((change) => change.kind !== "removed");
  const primary =
    activeChanges.find(
      (change) =>
        step.changed === change.label || step.write?.name === change.name,
    ) || activeChanges[0];
  const node = pickNode(context, step, primary);
  const source = node
    ? context.source.slice(node.start, node.end)
    : context.source.split("\n")[step.line - 1]?.trim() || "";
  const lesson = {
    kind: "observe",
    title: "Follow the highlighted line",
    explanation: step.explanation,
    code: source,
    changes,
    primary,
    reads: step.reads || [],
    nextLine: next?.line,
    nextCode: next ? context.source.split("\n")[next.line - 1]?.trim() : null,
  };
  if (step.type === "error")
    return {
      ...lesson,
      kind: "error",
      title: "Execution stopped here",
      explanation: step.explanation,
    };
  if (step.type === "complete")
    return {
      ...lesson,
      kind: "complete",
      title: "Your program has finished",
      explanation:
        "There are no more instructions to run. The values and output below are the final result.",
    };
  if (step.condition) {
    const parent = context.nodes.find((entry) => entry.node === node)?.parent;
    const loop =
      parent &&
      ["ForStatement", "WhileStatement", "DoWhileStatement"].includes(
        parent.type,
      );
    const actual = node ? snapshotValue(node, step.variables) : UNKNOWN;
    const value =
      actual !== UNKNOWN && Boolean(actual) === Boolean(step.result)
        ? substituted(node, step.variables, context)
        : null;
    return {
      ...lesson,
      kind: "condition",
      title: loop
        ? step.result
          ? "The loop continues"
          : "The loop stops"
        : step.result
          ? "This condition is true"
          : "This condition is false",
      explanation: loop
        ? step.result
          ? "The check passed. Run the loop body again."
          : "The check failed. Leave this loop and continue below it."
        : step.result
          ? "Run the if block."
          : parent?.alternate
            ? "Skip the if block and run the else branch."
            : "Skip the if block and continue after it.",
      code: step.condition,
      substitution: value,
      result: Boolean(step.result),
    };
  }
  if (step.type === "call")
    return {
      ...lesson,
      kind: "call",
      title: `Enter ${step.functionName || step.callStack?.at(-1)?.name || "the function"}()`,
      explanation:
        "Pass the argument values into this function's parameters. Its local values live in a separate scope.",
    };
  if (step.type === "return" || step.type === "call-result")
    return {
      ...lesson,
      kind: "return",
      title: "Send a value back to the caller",
      explanation: `${step.functionName || "This function"} returns ${lessonValue(step.returnValue)}. Continue from the place where it was called.`,
      substitution: lessonValue(step.returnValue),
    };
  if (step.type === "function")
    return {
      ...lesson,
      kind: "define",
      title: `Define ${step.functionName}()`,
      explanation:
        "Save these instructions for later. The function body runs when the function is called.",
    };
  if (step.type === "output")
    return {
      ...lesson,
      kind: "output",
      title: "Show a value in the output",
      explanation:
        "console.log displays this value. Printing a value does not change the variable.",
      substitution: step.logged,
    };
  if (primary) {
    const before = previous?.variables || {};
    let substitution;
    if (node?.type === "UpdateExpression" && typeof primary.before === "number")
      substitution = `${lessonValue(primary.before)} ${node.operator === "++" ? "+" : "−"} 1 = ${lessonValue(primary.after)}`;
    else if (node?.type === "AssignmentExpression") {
      if (node.operator !== "=") {
        const right = snapshotValue(node.right, before);
        const computed =
          right === UNKNOWN
            ? UNKNOWN
            : snapshotValue(
                {
                  type: "BinaryExpression",
                  operator: node.operator.slice(0, -1),
                  left: { type: "Literal", value: primary.before },
                  right: { type: "Literal", value: right },
                },
                {},
              );
        if (
          right !== UNKNOWN &&
          computed !== UNKNOWN &&
          same(computed, primary.after)
        )
          substitution = `${lessonValue(primary.before)} ${node.operator.slice(0, -1)} ${lessonValue(right)} = ${lessonValue(primary.after)}`;
      } else {
        const resolved = substituted(node.right, before, context);
        const computed = snapshotValue(node.right, before);
        if (
          resolved !== null &&
          computed !== UNKNOWN &&
          same(computed, primary.after)
        )
          substitution = `${resolved} → ${lessonValue(primary.after)}`;
      }
    }
    if (
      node?.type === "VariableDeclarator" &&
      node.init &&
      node.init.type !== "Literal"
    ) {
      const computed = snapshotValue(node.init, before);
      const resolved = substituted(node.init, before, context);
      if (
        computed !== UNKNOWN &&
        same(computed, primary.after) &&
        resolved !== null
      )
        substitution = `${resolved} → ${lessonValue(primary.after)}`;
    }
    if (!substitution && step.calculation)
      substitution = `${lessonValue(step.calculation.left)} ${step.calculation.operator} ${lessonValue(step.calculation.right)} = ${lessonValue(step.calculation.value)}`;
    lesson.kind = primary.kind === "created" ? "create" : "change";
    lesson.title = `${primary.kind === "created" ? "Create" : "Update"} ${primary.label}`;
    lesson.explanation =
      primary.kind === "created"
        ? `Store ${lessonValue(primary.after)} in ${primary.label}.`
        : `${primary.label} changes from ${lessonValue(primary.before)} to ${lessonValue(primary.after)}.`;
    lesson.substitution = substitution;
    if (node?.type === "UpdateExpression")
      lesson.explanation = `${node.operator === "++" ? "Increase" : "Decrease"} ${primary.label} by 1. The next instruction uses the new value.`;
  } else if (changes.some((change) => change.kind === "removed")) {
    lesson.kind = "scope";
    lesson.title = "Leave this local scope";
    lesson.explanation =
      "These local variables are no longer available outside their block.";
  } else if (step.type === "loop") {
    lesson.kind = "loop";
    lesson.title = "Start the next loop iteration";
    lesson.explanation = "Use the current index to run the loop body.";
  }

  return lesson;
}

export function createExecutionLesson(context, step, previous, next) {
  const lesson = createLessonBase(context, step, previous, next);
  if (!step || lesson.kind === "error") return lesson;
  const primary = lesson.primary;
  const node = pickNode(context, step, primary);
  const source = lesson.code || "";
  if (lesson.kind === "condition" && lesson.substitution !== null && node) {
    lesson.inputs = expressionInputs(node, step.variables, context);
    if (
      node.type === "BinaryExpression" &&
      node.left.type === "MemberExpression" &&
      node.right.value === " " &&
      node.operator === "==="
    ) {
      const value = snapshotValue(node.left, step.variables);
      const position = node.left.computed
        ? snapshotValue(node.left.property, step.variables)
        : UNKNOWN;
      if (typeof value === "string" && position !== UNKNOWN) {
        lesson.title = `Check the character at index ${position}`;
        lesson.explanation =
          value === " "
            ? "This character is a space. Run the if block."
            : `This character is ${lessonValue(value)}, not a space. Skip this if block.`;
      }
    }
    const remainder = context.nodes.find(
      ({ node: item }) =>
        item.type === "BinaryExpression" &&
        item.operator === "%" &&
        item.start >= node.start &&
        item.end <= node.end,
    )?.node;
    if (remainder) {
      const left = snapshotValue(remainder.left, step.variables);
      const right = snapshotValue(remainder.right, step.variables);
      const value = snapshotValue(remainder, step.variables);
      if (left !== UNKNOWN && right !== UNKNOWN && value !== UNKNOWN)
        lesson.explanation =
          right === 0
            ? `Taking a remainder with 0 gives NaN. ${lesson.explanation}`
            : `${lessonValue(left)} % ${lessonValue(right)} gives ${lessonValue(value)}, the remainder after division. ${lesson.explanation}`;
    }
  }
  const strings = Object.entries(step.variables || {}).filter(
    ([, entry]) => entry.type === "string",
  );
  const relatedToLoop = (name) =>
    context.nodes.some(
      ({ node: item }) =>
        item.type === "MemberExpression" &&
        item.object.name === name &&
        item.property.type === "Identifier" &&
        item.computed &&
        step.loops?.some((loop) => loop.indexName === item.property.name),
    );
  const stringEntry =
    strings.find(([name]) => name === primary?.name) ||
    strings.find(([name]) =>
      context.nodes.some(
        ({ node: item }) =>
          item.type === "Identifier" &&
          item.name === name &&
          item.loc.start.line === step.line,
      ),
    ) ||
    strings.find(([name]) => relatedToLoop(name));
  if (stringEntry) {
    const [name, entry] = stringEntry;
    const pointerName =
      [...(step.loops || [])]
        .reverse()
        .find(
          (loop) => typeof step.variables[loop.indexName]?.value === "number",
        )?.indexName ||
      context.nodes.find(
        ({ node: item }) =>
          item.type === "MemberExpression" &&
          item.object.name === name &&
          item.property.type === "Identifier" &&
          item.computed,
      )?.node.property.name;
    const before =
      previous?.variables?.[name]?.type === "string"
        ? previous.variables[name].value
        : entry.value;
    const index = pointerName ? step.variables[pointerName]?.value : -1;
    const oldIndex = pointerName
      ? previous?.variables?.[pointerName]?.value
      : -1;
    lesson.string = {
      name,
      before,
      after: entry.value,
      index: Number.isInteger(index) ? index : -1,
      beforeIndex: Number.isInteger(oldIndex) ? oldIndex : -1,
      pointerName: Number.isInteger(index) ? pointerName : undefined,
      changed: before !== entry.value,
    };
    const call = node?.type === "AssignmentExpression" ? node.right : null;
    if (
      lesson.string.changed &&
      call?.type === "CallExpression" &&
      call.callee.type === "MemberExpression" &&
      call.callee.object.name === name &&
      call.callee.property.name === "replace" &&
      call.arguments[0]?.value === " " &&
      call.arguments[1]?.value === "" &&
      before.replace(" ", "") === entry.value
    ) {
      lesson.title = `Remove the first space from ${name}`;
      lesson.explanation =
        "replace returns a new string with the first space removed. Assign that new string back to the variable.";
      lesson.string.removedIndex = before.indexOf(" ");
    }
    if (
      node?.type === "UpdateExpression" &&
      node.operator === "--" &&
      node.argument.name === pointerName &&
      relatedToLoop(name)
    ) {
      const loop = context.nodes.find(
        ({ node: item }) =>
          item.type === "ForStatement" &&
          step.loops?.some(
            (activeLoop) => activeLoop.line === item.loc.start.line,
          ) &&
          item.update?.type === "UpdateExpression" &&
          item.update.operator === "++" &&
          item.update.argument.name === pointerName,
      );
      const removesSpace =
        loop &&
        context.nodes.some(
          ({ node: item }) =>
            item.start > loop.node.body.start &&
            item.end < loop.node.body.end &&
            item.type === "CallExpression" &&
            item.callee.object?.name === name &&
            item.callee.property?.name === "replace" &&
            item.arguments[0]?.value === " " &&
            item.arguments[1]?.value === "",
        );
      lesson.title = `Move ${pointerName} back one position`;
      if (removesSpace)
        lesson.explanation = `The for-loop's ${pointerName}++ will bring it to the same index again, so the character that shifted left is checked next.`;
    }
  }
  return lesson;
}
