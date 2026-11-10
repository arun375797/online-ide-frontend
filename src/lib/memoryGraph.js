import { parse } from "acorn";

export function prepareMemorySource(source) {
  let program;
  try {
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      allowHashBang: true,
    });
  } catch {
    try {
      program = parse(source, {
        ecmaVersion: "latest",
        sourceType: "script",
        locations: true,
      });
    } catch {
      return [];
    }
  }
  const loops = [];
  function names(pattern) {
    if (!pattern) return [];
    if (pattern.type === "Identifier") return [pattern.name];
    if (pattern.type === "RestElement") return names(pattern.argument);
    if (pattern.type === "AssignmentPattern") return names(pattern.left);
    if (pattern.type === "ArrayPattern") return pattern.elements.flatMap(names);
    if (pattern.type === "ObjectPattern")
      return pattern.properties.flatMap((property) =>
        names(property.value || property.argument),
      );
    return [];
  }
  function declarations(node) {
    if (
      !node?.type ||
      [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression",
      ].includes(node.type)
    )
      return [];
    const found =
      node.type === "VariableDeclarator"
        ? names(node.id).map((name) => ({ name, line: node.loc.start.line }))
        : [];
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue;
      if (Array.isArray(value))
        value.forEach((item) => {
          if (item?.type) found.push(...declarations(item));
        });
      else if (value?.type) found.push(...declarations(value));
    }
    return found;
  }
  function visit(node) {
    if (!node?.type) return;
    if (
      [
        "ForStatement",
        "ForOfStatement",
        "ForInStatement",
        "WhileStatement",
        "DoWhileStatement",
      ].includes(node.type)
    )
      loops.push({
        line: node.loc.start.line,
        endLine: node.loc.end.line,
        declaredVariables: declarations(node),
        kind: node.type.startsWith("For")
          ? "for"
          : node.type === "DoWhileStatement"
            ? "do / while"
            : "while",
      });
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue;
      if (Array.isArray(value))
        value.forEach((item) => {
          if (item?.type) visit(item);
        });
      else if (value?.type) visit(value);
    }
  }
  visit(program);
  return loops;
}

export function memoryValue(value, type) {
  if (type === "function")
    return String(value).replace(/^\[Function (.*)\]$/, "$1()");
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fallbackReference(frame, name, entry) {
  return (
    entry.reference ||
    (entry.value && typeof entry.value === "object"
      ? `binding-${frame.id}-${name}-${entry.declaredAt || entry.line}`
      : undefined)
  );
}

function scopeFrames(step, sourceLoops) {
  const stack = step?.callStack?.length
    ? step.callStack
    : [{ id: 0, name: "Global", variables: step?.variables || {} }];
  return stack.map((frame) => {
    const activeLoops = (step.loops || []).filter((loop) =>
      loop.owner !== undefined
        ? loop.owner === frame.id
        : frame.id === stack.at(-1).id,
    );
    const groups = activeLoops.map((loop) => ({
      id: `${frame.id}:loop:${loop.line}`,
      ...loop,
      kind: sourceLoops.find((item) => item.line === loop.line)?.kind || "for",
      rows: [],
    }));
    const rows = [];
    const variables = { ...frame.variables };
    if (frame.id === stack.at(-1).id)
      for (const [name, entry] of Object.entries(step.variables || {}))
        if (
          !Object.hasOwn(variables, name) &&
          !stack.some(
            (other) =>
              other.id !== frame.id &&
              Object.hasOwn(other.variables || {}, name),
          )
        )
          variables[name] = entry;
    for (const [name, entry] of Object.entries(variables)) {
      const row = {
        name,
        ...entry,
        reference: fallbackReference(frame, name, entry),
        sourceId: `scope:${frame.id}:${name}:${entry.declaredAt ?? entry.line}`,
      };
      const declaration = entry.declaredAt ?? entry.line;
      const group =
        groups.find((loop) => loop.indexName === name) ||
        [...groups].reverse().find((loop) => {
          const range = sourceLoops.find((item) => item.line === loop.line);
          return range?.declaredVariables.some(
            (binding) => binding.name === name && binding.line === declaration,
          );
        });
      if (group) group.rows.push(row);
      else rows.push(row);
    }
    return {
      id: frame.id,
      name: frame.id === 0 ? "Main Block" : `${frame.name}()`,
      returning: frame.returning,
      active: frame.id === stack.at(-1).id,
      rows,
      loops: groups.filter((loop) => loop.rows.length || loop.iteration > 0),
    };
  });
}

export function buildMemoryGraph(events, activeStep, sourceLoops = []) {
  const current = events[activeStep];
  if (!current) return { scopes: [], heap: [], roots: [], live: new Set() };
  const ledger = new Map();
  const roots = new Map();
  for (let index = 0; index <= activeStep; index++) {
    const step = events[index];
    for (const node of step.heap || []) {
      const earlier = ledger.get(node.id);
      ledger.set(node.id, {
        ...node,
        firstStep: earlier?.firstStep ?? index,
        order: earlier?.order ?? ledger.size,
        updatedAt: index,
        previousValue: earlier?.value,
      });
    }
    const recordedFrames = step.callStack || [];
    for (const frame of [
      ...recordedFrames,
      { id: recordedFrames.at(-1)?.id || 0, variables: step.variables },
    ]) {
      for (const [name, entry] of Object.entries(frame.variables || {})) {
        const id = fallbackReference(frame, name, entry);
        if (!id) continue;
        if (!ledger.has(id))
          ledger.set(id, {
            id,
            kind: Array.isArray(entry.value) ? "array" : "object",
            value: entry.value,
            links: [],
            firstStep: index,
            order: ledger.size,
          });
        else if (!entry.reference)
          ledger.set(id, { ...ledger.get(id), value: entry.value });
        if (!roots.has(id))
          roots.set(id, { id, names: new Set(), firstStep: index });
        roots.get(id).names.add(name);
      }
    }
  }
  const scopes = scopeFrames(current, sourceLoops);
  const live = new Set();
  function markLive(id) {
    if (!id || live.has(id)) return;
    live.add(id);
    ledger.get(id)?.links?.forEach((link) => markLive(link.reference));
  }
  scopes.forEach((scope) =>
    [...scope.rows, ...scope.loops.flatMap((loop) => loop.rows)].forEach(
      (row) => markLive(row.reference),
    ),
  );
  const visible = new Set(roots.keys());
  function expand(id) {
    const node = ledger.get(id);
    const matrix =
      node?.kind === "array" &&
      node.value.length > 0 &&
      node.value.every(Array.isArray);
    if (!node || matrix) return;
    for (const link of node.links || [])
      if (ledger.has(link.reference) && !visible.has(link.reference)) {
        visible.add(link.reference);
        expand(link.reference);
      }
  }
  [...visible].forEach(expand);
  const inlineRows = new Map();
  for (const id of visible) {
    const node = ledger.get(id);
    if (
      node?.kind === "array" &&
      node.value.length &&
      node.value.every(Array.isArray)
    ) {
      for (const link of node.links || []) {
        const row = ledger.get(link.reference);
        if (row?.kind === "array") {
          inlineRows.set(link.reference, { parent: id, row: Number(link.key) });
          for (const child of row.links || [])
            if (ledger.has(child.reference)) {
              visible.add(child.reference);
              expand(child.reference);
            }
        }
      }
    }
  }
  for (const id of inlineRows.keys()) visible.delete(id);
  const heap = [...visible]
    .map((id) => ledger.get(id))
    .filter(Boolean)
    .sort((left, right) => left.order - right.order)
    .map((node) => ({
      ...node,
      names: [...(roots.get(node.id)?.names || [])],
      live: live.has(node.id),
    }));
  return {
    scopes,
    heap,
    roots: [...roots.values()],
    live,
    objects: ledger,
    inlineRows,
  };
}
