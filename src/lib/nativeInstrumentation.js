import { parse } from "acorn";
import MagicString from "magic-string";

const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
const LOOPS = new Set([
  "ForStatement",
  "ForOfStatement",
  "ForInStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

function patternNames(node, names = []) {
  if (!node) return names;
  if (node.type === "Identifier") names.push(node.name);
  else if (node.type === "RestElement") patternNames(node.argument, names);
  else if (node.type === "AssignmentPattern") patternNames(node.left, names);
  else if (node.type === "ArrayPattern")
    node.elements.forEach((item) => patternNames(item, names));
  else if (node.type === "ObjectPattern")
    node.properties.forEach((item) =>
      patternNames(
        item.type === "RestElement" ? item.argument : item.value,
        names,
      ),
    );
  return names;
}

export function instrumentJavaScript(source) {
  let ast;
  let module = false;
  try {
    ast = parse(source, {
      ecmaVersion: "latest",
      sourceType: "script",
      locations: true,
      allowHashBang: true,
    });
  } catch {
    ast = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      allowHashBang: true,
    });
    module = true;
  }
  let prefix = "__myide_trace";
  while (source.includes(prefix)) prefix += "_";
  const helper = `${prefix}_api`;
  const root = {
    parent: null,
    bindings: new Map(),
    token: "0",
    functionScope: true,
  };
  const nodes = [];
  const context = new WeakMap();
  let nextFunction = 0;
  const bind = (scope, name, node, kind) =>
    scope.bindings.set(name, {
      name,
      line: node.loc.start.line,
      kind,
      token: scope.token,
    });

  function visit(node, scope, parent = null, key = "") {
    if (!node || typeof node.type !== "string") return;
    const outer = scope;
    if (node.type === "FunctionDeclaration" && node.id)
      bind(scope, node.id.name, node, "function");
    if (node.type === "ClassDeclaration" && node.id)
      bind(scope, node.id.name, node, "class");
    if (FUNCTIONS.has(node.type)) {
      scope = {
        parent: scope,
        bindings: new Map(),
        token:
          node.type === "ArrowFunctionExpression" &&
          node.body.type !== "BlockStatement"
            ? scope.token
            : `${prefix}_frame_${++nextFunction}`,
        functionScope: true,
      };
      node.params.forEach((param) =>
        patternNames(param).forEach((name) =>
          bind(scope, name, param, "parameter"),
        ),
      );
      if (node.type === "FunctionExpression" && node.id)
        bind(scope, node.id.name, node, "function");
    } else if (
      node.type === "BlockStatement" ||
      LOOPS.has(node.type) ||
      node.type === "CatchClause" ||
      node.type === "StaticBlock"
    ) {
      scope = {
        parent: scope,
        bindings: new Map(),
        token: scope.token,
        functionScope: false,
      };
      if (node.type === "CatchClause")
        patternNames(node.param).forEach((name) =>
          bind(scope, name, node, "let"),
        );
    }
    if (node.type === "VariableDeclaration") {
      let target = scope;
      if (node.kind === "var")
        while (target.parent && !target.functionScope) target = target.parent;
      node.declarations.forEach((declaration) =>
        patternNames(declaration.id).forEach((name) =>
          bind(target, name, declaration, node.kind),
        ),
      );
    }
    if (node.type === "ImportDeclaration")
      node.specifiers.forEach((specifier) =>
        bind(scope, specifier.local.name, specifier, "const"),
      );
    const entry = { node, scope, outer, parent, key };
    nodes.push(entry);
    context.set(node, entry);
    for (const [property, value] of Object.entries(node)) {
      if (property === "loc") continue;
      if (Array.isArray(value))
        value.forEach((child) => {
          if (child?.type) visit(child, scope, node, property);
        });
      else if (value?.type) visit(value, scope, node, property);
    }
  }
  visit(ast, root);
  const code = new MagicString(source);
  const line = (node) => node.loc.start.line;
  function readers(scope, enteringToken = null) {
    const chain = [];
    for (let current = scope; current; current = current.parent)
      chain.unshift(current);
    const bindings = new Map();
    chain.forEach((current) =>
      current.bindings.forEach((binding, name) => bindings.set(name, binding)),
    );
    return `{${[...bindings.values()].map((binding) => `${JSON.stringify(binding.name)}:[()=>${binding.name},${binding.token === enteringToken ? "-1" : binding.token},${binding.line},${JSON.stringify(binding.kind)}]`).join(",")}}`;
  }
  const statementScope = (entry) =>
    FUNCTIONS.has(entry.node.type) ||
    LOOPS.has(entry.node.type) ||
    entry.node.type === "ClassDeclaration"
      ? entry.outer
      : entry.scope;
  const hook = (entry, type = "statement") =>
    `${helper}.step(${line(entry.node)},${JSON.stringify(type)},${readers(statementScope(entry))},${statementScope(entry).token});`;
  const directiveEnd = (body, fallback) => {
    let position = fallback;
    for (const statement of body) {
      if (!statement.directive) break;
      position = statement.end;
    }
    return position;
  };
  const bootPosition = directiveEnd(
    ast.body,
    source.startsWith("#!") ? source.indexOf("\n") + 1 || source.length : 0,
  );
  code.appendLeft(
    bootPosition,
    `;const ${helper}=globalThis[${JSON.stringify(prefix)}];${helper}.globals(${readers(root)});`,
  );
  const closing = [];
  for (const entry of nodes) {
    const { node, scope, parent } = entry;
    if (node.type === "AwaitExpression") {
      code.appendLeft(node.argument.start, `${helper}.awaited((`);
      code.prependLeft(node.argument.end, "))");
    }
    if (FUNCTIONS.has(node.type) && node.body.type === "BlockStatement") {
      const inferred =
        node.id?.name ||
        (parent?.type === "VariableDeclarator"
          ? parent.id.name
          : parent?.key?.name || "anonymous");
      const position = directiveEnd(node.body.body, node.body.start + 1);
      code.appendLeft(
        position,
        `;const ${scope.token}=${helper}.enter(${JSON.stringify(inferred)},${line(node)},${readers(scope, scope.token)});try{`,
      );
      closing.push([
        node.body.end - 1,
        `}finally{${helper}.leave(${scope.token});}`,
      ]);
    }
    // Expression arrows keep their original expression body and lexical semantics.
    // Their surrounding statement still records native callback results.
    if (node.type === "IfStatement" || (LOOPS.has(node.type) && node.test)) {
      const test = node.test;
      code.appendLeft(test.start, `${helper}.condition(${line(test)},(`);
      code.prependLeft(
        test.end,
        `),${readers(scope)},${scope.token},${JSON.stringify(source.slice(test.start, test.end))})`,
      );
    }
    if (LOOPS.has(node.type)) {
      const bodyScope = context.get(node.body).scope;
      const indexName =
        patternNames(
          node.init?.declarations?.[0]?.id ||
            node.left?.declarations?.[0]?.id ||
            node.left,
        )[0] || "";
      const tick = `${helper}.loop(${line(node)},${JSON.stringify(indexName)},${readers(bodyScope)},${scope.token});`;
      if (node.body.type === "BlockStatement")
        code.appendLeft(node.body.start + 1, tick);
      else {
        code.appendLeft(node.body.start, `{${tick}`);
        closing.push([node.body.end, "}"]);
      }
      if (node.type === "ForStatement" && node.update) {
        code.appendLeft(node.update.start, "(");
        code.prependLeft(
          node.update.end,
          `,${helper}.step(${line(node.update)},"assignment",${readers(scope)},${scope.token}))`,
        );
      }
    }
    if (node.type === "ReturnStatement") {
      if (node.argument) {
        code.appendLeft(node.argument.start, `${helper}.returned((`);
        code.prependLeft(
          node.argument.end,
          `),${line(node)},${readers(scope)},${scope.token})`,
        );
      } else
        code.appendLeft(
          node.start + 6,
          ` ${helper}.returned(undefined,${line(node)},${readers(scope)},${scope.token})`,
        );
    }
  }
  for (const entry of nodes) {
    const { node, parent, key } = entry;
    if (!parent || node.directive || node.type === "EmptyStatement") continue;
    const statementList =
      ((parent.type === "Program" ||
        parent.type === "BlockStatement" ||
        parent.type === "StaticBlock") &&
        key === "body") ||
      (parent.type === "SwitchCase" && key === "consequent");
    if (!statementList) continue;
    code.appendLeft(node.start, hook(entry, "before"));
    if (
      ![
        "ReturnStatement",
        "ThrowStatement",
        "BreakStatement",
        "ContinueStatement",
      ].includes(node.type)
    ) {
      code.appendLeft(
        node.end,
        `;${LOOPS.has(node.type) ? `${helper}.endLoop(${line(node)},${statementScope(entry).token});` : ""}${hook(entry, node.type === "VariableDeclaration" ? "variable" : "statement")}`,
      );
    }
  }
  // Close inner bodies first when a return expression and a body share an offset.
  closing
    .sort((left, right) => right[0] - left[0])
    .forEach(([position, text]) => code.appendLeft(position, text));
  for (const { node, parent } of nodes) {
    if (
      !["CallExpression", "NewExpression", "ImportExpression"].includes(
        node.type,
      )
    )
      continue;
    let ancestor = parent;
    let optionalChain = false;
    while (ancestor) {
      if (ancestor.type === "ChainExpression") {
        optionalChain = true;
        break;
      }
      ancestor = context.get(ancestor)?.parent;
    }
    if (!optionalChain) {
      code.appendLeft(node.start, `${helper}.watch((`);
      code.prependLeft(node.end, "))");
    }
  }
  return { code: code.toString(), module, helperName: prefix, source };
}
