import { parse } from "acorn";

const MAX_SOURCE_LENGTH = 30_000;
const MAX_STEPS = 2_000;
const MAX_LOOP_ITERATIONS = 500;
const MAX_ARRAY_LENGTH = 1_000;
const MAX_LOG_LENGTH = 5_000;
const MAX_OUTPUT_LINES = 250;
const MAX_TOTAL_OUTPUT_LENGTH = 25_000;
const MAX_CALL_DEPTH = 32;
const FUNCTION = Symbol("interpreted function");

class ReturnSignal {
  constructor(value) {
    this.value = value;
  }
}
const MAX_SNAPSHOT_VALUES = 200_000;

function cloneValue(value) {
  if (value?.[FUNCTION]) return `[Function ${value[FUNCTION].name}]`;
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
    );
  }
  return value;
}

function formatValue(value) {
  if (value?.[FUNCTION]) return `[Function ${value[FUNCTION].name}]`;
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function locationOf(node) {
  return {
    line: node.loc?.start.line ?? 1,
    column: node.loc?.start.column ?? 0,
  };
}

function unsupported(node) {
  const { line, column } = locationOf(node);
  const error = new Error(
    `Unsupported JavaScript syntax (${node.type}) at ${line}:${column + 1}. Supported: variables, arrays, expressions, if statements, for loops, functions, return, and console.log.`,
  );
  error.line = line;
  error.column = column;
  throw error;
}

export function traceJavaScript(source) {
  if (typeof source !== "string" || source.length > MAX_SOURCE_LENGTH) {
    throw new Error(
      `Code is too long to visualize (maximum ${MAX_SOURCE_LENGTH.toLocaleString()} characters).`,
    );
  }

  let program;
  try {
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "script",
      locations: true,
    });
  } catch (error) {
    const line = error.loc?.line ?? 1;
    const column = (error.loc?.column ?? 0) + 1;
    const syntaxError = new Error(
      `Syntax error at ${line}:${column}: ${error.message.replace(/\s*\(\d+:\d+\)$/, "")}`,
    );
    syntaxError.line = line;
    syntaxError.column = column - 1;
    throw syntaxError;
  }

  const globalScope = { name: "global", values: new Map() };
  let scopes = [globalScope];
  const calls = [];
  let nextCallId = 0;
  const events = [];
  const output = [];
  const loops = [];
  const pendingReads = new Map();
  const calculations = new WeakMap();
  const objectReferences = new WeakMap();
  let nextReference = 0;
  let steps = 0;
  let capturedValues = 0;

  function referenceId(value) {
    if (!value || typeof value !== "object" || value[FUNCTION])
      return undefined;
    if (!objectReferences.has(value))
      objectReferences.set(value, `ref-${++nextReference}`);
    return objectReferences.get(value);
  }

  function snapshotHeap() {
    const heap = new Map();
    function visit(value) {
      const id = referenceId(value);
      if (!id || heap.has(id)) return;
      const links = Object.entries(value)
        .filter(([, item]) => referenceId(item))
        .map(([key, item]) => ({ key, reference: referenceId(item) }));
      heap.set(id, {
        id,
        kind: Array.isArray(value) ? "array" : "object",
        value: cloneValue(value),
        links,
      });
      Object.values(value).forEach(visit);
    }
    for (const scope of scopes)
      for (const binding of scope.values.values()) visit(binding.value);
    for (const frame of calls)
      for (const scope of frame.scopes)
        for (const binding of scope.values.values()) visit(binding.value);
    return [...heap.values()];
  }

  function countValue(value) {
    const pending = [value];
    let count = 0;
    while (pending.length) {
      const current = pending.pop();
      count += 1;
      if (Array.isArray(current)) pending.push(...current);
    }
    return count;
  }

  function resolveBinding(name) {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      if (scopes[index].values.has(name)) return scopes[index].values.get(name);
    }
    throw new Error(`"${name}" is not defined.`);
  }

  function snapshotVariables(visibleScopes = scopes) {
    const variables = {};
    for (const scope of visibleScopes) {
      for (const [name, binding] of scope.values) {
        variables[name] = {
          value: cloneValue(binding.value),
          type: binding.value?.[FUNCTION]
            ? "function"
            : binding.value === null
              ? "null"
              : Array.isArray(binding.value)
                ? "array"
                : typeof binding.value,
          scope: scope.name,
          line: binding.line,
          mutable: binding.mutable,
          reference: referenceId(binding.value),
          declaredAt: binding.declaredAt ?? binding.line,
        };
      }
    }
    return variables;
  }

  function snapshotCallStack() {
    return [
      { id: 0, name: "Global", variables: snapshotVariables([globalScope]) },
      ...calls.map((frame) => ({
        id: frame.id,
        name: frame.name,
        callLine: frame.callLine,
        definitionLine: frame.definitionLine,
        returning: frame.returning || false,
        returnValue: cloneValue(frame.returnValue),
        variables: snapshotVariables(frame.scopes.slice(frame.localStart)),
      })),
    ];
  }

  function makeFunction(node, name = node.id?.name || "anonymous") {
    if (
      node.async ||
      node.generator ||
      node.params.some((param) => param.type !== "Identifier")
    )
      unsupported(node);
    return { [FUNCTION]: { node, name, environment: [...scopes] } };
  }

  function hoistFunctions(statements) {
    const scope = scopes[scopes.length - 1];
    for (const statement of statements) {
      if (statement.type !== "FunctionDeclaration") continue;
      scope.values.set(statement.id.name, {
        value: makeFunction(statement),
        mutable: true,
        line: locationOf(statement).line,
        declaredAt: locationOf(statement).line,
      });
    }
  }

  function callFunction(node) {
    if (node.optional) unsupported(node);
    if (
      node.callee.type === "MemberExpression" &&
      node.callee.object.type === "Identifier" &&
      node.callee.object.name === "console" &&
      !node.callee.computed &&
      node.callee.property.name === "log"
    ) {
      executeConsole(node);
      return undefined;
    }
    if (
      node.callee.type === "Identifier" &&
      !scopes.some((scope) => scope.values.has(node.callee.name))
    )
      unsupported(node);
    const fn = evaluate(node.callee)?.[FUNCTION];
    if (!fn)
      throw new Error(
        `${source.slice(node.callee.start, node.callee.end)} is not a function.`,
      );
    const args = node.arguments.map((argument) => {
      if (argument.type === "SpreadElement") unsupported(argument);
      return evaluate(argument);
    });
    if (calls.length >= MAX_CALL_DEPTH)
      throw new Error(
        `Function calls are limited to ${MAX_CALL_DEPTH} nested frames.`,
      );
    const callerScopes = scopes;
    const localScope = { name: `${fn.name}()`, values: new Map() };
    fn.node.params.forEach((param, index) =>
      localScope.values.set(param.name, {
        value: args[index],
        mutable: true,
        line: locationOf(param).line,
        declaredAt: locationOf(param).line,
      }),
    );
    if (
      fn.node.type === "FunctionExpression" &&
      fn.node.id &&
      !localScope.values.has(fn.node.id.name)
    )
      localScope.values.set(fn.node.id.name, {
        value: { [FUNCTION]: fn },
        mutable: false,
        line: locationOf(fn.node).line,
        declaredAt: locationOf(fn.node).line,
      });
    scopes = [...fn.environment, localScope];
    const frame = {
      id: ++nextCallId,
      name: fn.name,
      callLine: locationOf(node).line,
      definitionLine: locationOf(fn.node).line,
      scopes,
      localStart: fn.environment.length,
    };
    calls.push(frame);
    let value;
    try {
      record(
        node,
        "call",
        `Call ${fn.name}(${args.map(formatValue).join(", ")}).`,
        { functionName: fn.name, arguments: args.map(cloneValue) },
      );
      try {
        if (fn.node.body.type === "BlockStatement") execute(fn.node.body);
        else value = evaluate(fn.node.body);
        frame.returning = true;
        frame.returnValue = value;
        record(
          fn.node.body,
          "return",
          `${fn.name} returns ${formatValue(value)}.`,
          { functionName: fn.name, returnValue: cloneValue(value) },
        );
      } catch (signal) {
        if (!(signal instanceof ReturnSignal)) throw signal;
        value = signal.value;
      }
    } finally {
      calls.pop();
      scopes = callerScopes;
    }
    record(
      node,
      "call-result",
      `${fn.name} returned ${formatValue(value)} to its caller.`,
      { functionName: fn.name, returnValue: cloneValue(value) },
    );
    return value;
  }

  function record(node, type, explanation, extra = {}) {
    steps += 1;
    if (steps > MAX_STEPS) {
      throw new Error(
        `Visualization stopped after ${MAX_STEPS.toLocaleString()} steps. Reduce the input or loop size.`,
      );
    }
    const variables = snapshotVariables();
    const callStack = snapshotCallStack();
    const heap = snapshotHeap();
    capturedValues += Object.values(variables).reduce(
      (total, entry) => total + countValue(entry.value),
      0,
    );
    capturedValues += callStack.reduce(
      (total, frame) =>
        total +
        Object.values(frame.variables).reduce(
          (sum, entry) => sum + countValue(entry.value),
          0,
        ),
      0,
    );
    if (capturedValues > MAX_SNAPSHOT_VALUES) {
      throw new Error(
        `Visualization stopped after ${MAX_SNAPSHOT_VALUES.toLocaleString()} recorded values to protect memory.`,
      );
    }
    events.push({
      step: steps,
      line: node.loc?.start.line ?? 1,
      column: node.loc?.start.column ?? 0,
      type,
      explanation,
      variables,
      callStack,
      heap,
      loops: loops.map((loop) => ({
        ...loop,
        indexValue: variables[loop.indexName]?.value,
      })),
      output: output.length,
      reads: [...pendingReads.values()],
      calculation: calculations.get(node),
      ...extra,
    });
    pendingReads.clear();
  }

  function declare(name, value, mutable, node) {
    const scope = scopes[scopes.length - 1];
    if (scope.values.has(name))
      throw new Error(`"${name}" has already been declared in this scope.`);
    if (Array.isArray(value) && value.length > MAX_ARRAY_LENGTH)
      throw new Error("Arrays are limited to 1,000 items.");
    if (value?.[FUNCTION]?.name === "anonymous") value[FUNCTION].name = name;
    scope.values.set(name, { value, mutable, line: locationOf(node).line });
    scope.values.get(name).declaredAt = locationOf(node).line;
    record(
      node,
      "variable",
      `${name} is initialized to ${formatValue(value)}.`,
      { changed: name },
    );
  }

  function reference(node) {
    if (node.type === "Identifier") {
      const binding = resolveBinding(node.name);
      return {
        get: () => binding.value,
        set: (value) => {
          if (!binding.mutable)
            throw new Error(`Cannot assign to constant "${node.name}".`);
          binding.value = value;
          binding.line = locationOf(node).line;
          return value;
        },
        name: node.name,
        rootName: node.name,
        arrayPath: [],
      };
    }
    if (node.type === "MemberExpression") {
      const parent = ["Identifier", "MemberExpression"].includes(
        node.object.type,
      )
        ? reference(node.object)
        : null;
      const target = parent ? parent.get() : evaluate(node.object);
      const key = node.computed ? evaluate(node.property) : node.property.name;
      const arrayIndex = Number(key);
      const validIndex =
        Number.isInteger(arrayIndex) &&
        String(arrayIndex) === String(key) &&
        arrayIndex >= 0 &&
        arrayIndex < MAX_ARRAY_LENGTH;
      if (!Array.isArray(target) || (key !== "length" && !validIndex)) {
        unsupported(node);
      }
      return {
        get: () => target[key],
        set: (value) => {
          if (key === "length") {
            if (
              !Number.isInteger(value) ||
              value < 0 ||
              value > MAX_ARRAY_LENGTH
            ) {
              throw new Error(
                "Array length must be an integer from 0 to 1,000.",
              );
            }
            if (value > target.length)
              throw new Error(
                "Increasing array length and creating sparse slots are not supported.",
              );
            target.length = value;
          } else {
            if (arrayIndex > target.length) {
              throw new Error(
                "Sparse array writes are not supported. Write to an existing index or append at the current length.",
              );
            }
            target[key] = value;
            if (target.length > MAX_ARRAY_LENGTH)
              throw new Error("Arrays are limited to 1,000 items.");
          }
          if (parent?.rootName) {
            resolveBinding(parent.rootName).line = locationOf(node).line;
          }
          return value;
        },
        name: source.slice(node.start, node.end),
        rootName: parent?.rootName ?? "",
        arrayName: parent?.rootName ?? "",
        arrayPath: [...(parent?.arrayPath ?? []), key],
        target,
        key,
      };
    }
    unsupported(node);
  }

  function evaluate(node) {
    switch (node.type) {
      case "Literal":
        return node.value;
      case "Identifier":
        if (node.name === "undefined") return undefined;
        return resolveBinding(node.name).value;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        return makeFunction(node);
      case "CallExpression":
        return callFunction(node);
      case "ArrayExpression":
        return node.elements.map((element) => {
          if (!element) unsupported(node);
          if (element.type === "SpreadElement") unsupported(element);
          return evaluate(element);
        });
      case "UnaryExpression": {
        const value = evaluate(node.argument);
        if (node.operator === "!") return !value;
        if (node.operator === "+") return +value;
        if (node.operator === "-") return -value;
        if (node.operator === "typeof") return typeof value;
        unsupported(node);
        break;
      }
      case "BinaryExpression": {
        const left = evaluate(node.left);
        const right = evaluate(node.right);
        let value;
        switch (node.operator) {
          case "+":
            value = left + right;
            break;
          case "-":
            value = left - right;
            break;
          case "*":
            value = left * right;
            break;
          case "/":
            value = left / right;
            break;
          case "%":
            value = left % right;
            break;
          case "<":
            value = left < right;
            break;
          case "<=":
            value = left <= right;
            break;
          case ">":
            value = left > right;
            break;
          case ">=":
            value = left >= right;
            break;
          case "==":
            value = left == right;
            break; // Intentional JavaScript loose equality.
          case "!=":
            value = left != right;
            break;
          case "===":
            value = left === right;
            break;
          case "!==":
            value = left !== right;
            break;
          default:
            unsupported(node);
        }
        calculations.set(node, {
          operator: node.operator,
          left: cloneValue(left),
          right: cloneValue(right),
          value: cloneValue(value),
        });
        return value;
      }
      case "LogicalExpression": {
        const left = evaluate(node.left);
        if (node.operator === "&&") return left && evaluate(node.right);
        if (node.operator === "||") return left || evaluate(node.right);
        unsupported(node);
        break;
      }
      case "ConditionalExpression":
        return evaluate(node.test)
          ? evaluate(node.consequent)
          : evaluate(node.alternate);
      case "MemberExpression": {
        const ref = reference(node);
        const value = ref.get();
        if (ref.arrayName && pendingReads.size < 256) {
          const read = {
            name: ref.arrayName,
            path: ref.arrayPath,
            value: Array.isArray(value) ? undefined : cloneValue(value),
          };
          pendingReads.set(JSON.stringify([read.name, read.path]), read);
        }
        return value;
      }
      case "AssignmentExpression": {
        const ref = reference(node.left);
        const previous = ref.get();
        const right = evaluate(node.right);
        let value;
        switch (node.operator) {
          case "=":
            value = right;
            break;
          case "+=":
            value = previous + right;
            break;
          case "-=":
            value = previous - right;
            break;
          case "*=":
            value = previous * right;
            break;
          case "/=":
            value = previous / right;
            break;
          case "%=":
            value = previous % right;
            break;
          default:
            unsupported(node);
        }
        ref.set(value);
        const element =
          ref.arrayName && ref.key !== "length"
            ? ` (index ${String(ref.key)})`
            : "";
        record(
          node,
          "assignment",
          `${ref.name}${element} changes from ${formatValue(previous)} to ${formatValue(value)}.`,
          {
            changed: ref.name,
            previous: cloneValue(previous),
            arrayName: ref.arrayName,
            arrayPath: ref.arrayPath,
            write: ref.arrayName
              ? {
                  name: ref.arrayName,
                  path: ref.arrayPath,
                  value: cloneValue(value),
                  previous: cloneValue(previous),
                }
              : undefined,
            calculation:
              node.operator === "="
                ? calculations.get(node.right)
                : {
                    operator: node.operator.slice(0, -1),
                    left: cloneValue(previous),
                    right: cloneValue(right),
                    value: cloneValue(value),
                  },
            arrayIndex:
              ref.key !== "length" && Number.isInteger(Number(ref.key))
                ? Number(ref.key)
                : undefined,
          },
        );
        return value;
      }
      case "UpdateExpression": {
        const ref = reference(node.argument);
        const previous = ref.get();
        const value = node.operator === "++" ? previous + 1 : previous - 1;
        ref.set(value);
        const element =
          ref.arrayName && ref.key !== "length"
            ? ` (index ${String(ref.key)})`
            : "";
        record(
          node,
          "assignment",
          `${ref.name}${element} changes from ${formatValue(previous)} to ${formatValue(value)}.`,
          {
            changed: ref.name,
            previous: cloneValue(previous),
            arrayName: ref.arrayName,
            arrayPath: ref.arrayPath,
            write: ref.arrayName
              ? {
                  name: ref.arrayName,
                  path: ref.arrayPath,
                  value: cloneValue(value),
                  previous: cloneValue(previous),
                }
              : undefined,
            calculation: {
              operator: node.operator === "++" ? "+" : "-",
              left: cloneValue(previous),
              right: 1,
              value: cloneValue(value),
            },
            arrayIndex:
              ref.key !== "length" && Number.isInteger(Number(ref.key))
                ? Number(ref.key)
                : undefined,
          },
        );
        return node.prefix ? value : previous;
      }
      default:
        unsupported(node);
    }
  }

  function executeExpression(node) {
    const before = events.length;
    const value = evaluate(node);
    if (events.length === before) {
      record(
        node,
        "expression",
        `Evaluated ${source.slice(node.start, node.end)}${value === undefined ? "." : ` to ${formatValue(value)}.`}`,
      );
    }
  }

  function execute(node, depth = 0) {
    if (!node) return;
    try {
      return executeNode(node, depth);
    } catch (error) {
      if (!(error instanceof ReturnSignal) && !error.traceContext) {
        error.line ??= locationOf(node).line;
        error.traceContext = {
          variables: snapshotVariables(),
          callStack: snapshotCallStack(),
          loops: loops.map((loop) => ({ ...loop })),
          reads: [...pendingReads.values()],
        };
      }
      throw error;
    }
  }

  function executeNode(node, depth = 0) {
    if (depth > 100)
      throw new Error("The program is nested too deeply to visualize.");
    switch (node.type) {
      case "Program":
        hoistFunctions(node.body);
        for (const statement of node.body) execute(statement, depth + 1);
        return;
      case "BlockStatement":
        scopes.push({ name: "block", values: new Map() });
        try {
          hoistFunctions(node.body);
          for (const statement of node.body) execute(statement, depth + 1);
        } finally {
          scopes.pop();
        }
        return;
      case "EmptyStatement":
        return;
      case "VariableDeclaration":
        for (const declaration of node.declarations) {
          if (declaration.id.type !== "Identifier") unsupported(declaration);
          declare(
            declaration.id.name,
            declaration.init ? evaluate(declaration.init) : undefined,
            node.kind !== "const",
            declaration,
          );
        }
        return;
      case "ExpressionStatement":
        executeExpression(node.expression);
        return;
      case "IfStatement": {
        const result = evaluate(node.test);
        const condition = source.slice(node.test.start, node.test.end);
        record(
          node.test,
          "condition",
          `The condition ${condition} is ${result ? "true" : "false"}.`,
          {
            condition,
            result: Boolean(result),
          },
        );
        execute(result ? node.consequent : node.alternate, depth + 1);
        return;
      }
      case "ForStatement": {
        scopes.push({ name: "for loop", values: new Map() });
        const loop = {
          owner: calls.at(-1)?.id || 0,
          line: node.loc.start.line,
          iteration: 0,
          condition: "",
          indexName:
            node.init?.declarations?.[0]?.id?.name ??
            node.init?.left?.name ??
            "",
        };
        loops.push(loop);
        try {
          if (node.init) {
            if (node.init.type === "VariableDeclaration")
              execute(node.init, depth + 1);
            else executeExpression(node.init);
          }
          let guard = 0;
          while (true) {
            if (++guard > MAX_LOOP_ITERATIONS)
              throw new Error(
                `A loop exceeded ${MAX_LOOP_ITERATIONS} iterations.`,
              );
            const condition = node.test ? evaluate(node.test) : true;
            loop.condition = node.test
              ? source.slice(node.test.start, node.test.end)
              : "true";
            record(
              node.test || node,
              "loop-condition",
              `Loop condition ${loop.condition} is ${condition ? "true" : "false"}.`,
              {
                condition: loop.condition,
                result: Boolean(condition),
              },
            );
            if (!condition) break;
            loop.iteration += 1;
            execute(node.body, depth + 1);
            if (node.update) executeExpression(node.update);
          }
        } finally {
          loops.pop();
          scopes.pop();
        }
        return;
      }
      case "FunctionDeclaration":
        record(
          node,
          "function",
          `${node.id.name} is defined and ready to call.`,
          { functionName: node.id.name },
        );
        return;
      case "ReturnStatement": {
        const value = node.argument ? evaluate(node.argument) : undefined;
        const frame = calls.at(-1);
        if (!frame) unsupported(node);
        frame.returning = true;
        frame.returnValue = value;
        record(node, "return", `${frame.name} returns ${formatValue(value)}.`, {
          functionName: frame.name,
          returnValue: cloneValue(value),
          calculation: node.argument
            ? calculations.get(node.argument)
            : undefined,
        });
        throw new ReturnSignal(value);
      }
      case "WhileStatement":
      case "DoWhileStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "TryStatement":
      case "ThrowStatement":
        unsupported(node);
        return;
      default:
        unsupported(node);
    }
  }

  function executeConsole(node) {
    if (
      node.type !== "CallExpression" ||
      node.optional ||
      node.callee.type !== "MemberExpression" ||
      node.callee.object.type !== "Identifier" ||
      node.callee.object.name !== "console" ||
      node.callee.computed ||
      node.callee.property.name !== "log"
    ) {
      unsupported(node);
    }
    const args = node.arguments.map((argument) => {
      if (argument.type === "SpreadElement") unsupported(argument);
      return evaluate(argument);
    });
    const line = args
      .map((value) => (typeof value === "string" ? value : formatValue(value)))
      .join(" ");
    const text = line.slice(0, MAX_LOG_LENGTH);
    if (
      output.length >= MAX_OUTPUT_LINES ||
      output.reduce((total, item) => total + item.length, 0) + text.length >
        MAX_TOTAL_OUTPUT_LENGTH
    ) {
      throw new Error(
        `Console output is limited to ${MAX_OUTPUT_LINES} lines and ${MAX_TOTAL_OUTPUT_LENGTH.toLocaleString()} characters.`,
      );
    }
    output.push(text);
    record(node, "output", `console.log displays ${text}.`, { logged: text });
  }

  try {
    execute(program);
  } catch (error) {
    const errorEvent = {
      step: events.length + 1,
      line: error.line ?? 1,
      column: error.column ?? 0,
      type: "error",
      explanation: error.message,
      variables: snapshotVariables(),
      callStack: snapshotCallStack(),
      loops: loops.map((loop) => ({ ...loop })),
      output: output.length,
      ...error.traceContext,
    };
    events.push(errorEvent);
    return { events, output, error: error.message };
  }

  return { events, output, error: "" };
}
