const SNIPPETS = [
  {
    label: "cl",
    filterText: "cl console.log log clog",
    insertText: "console.log($1);",
    snippet: true,
    detail: "console.log(…)",
    doc: "Log a value to the output panel.",
  },
  {
    label: "console.log",
    filterText: "console.log cl log",
    insertText: "console.log($1);",
    snippet: true,
    detail: "console.log(…)",
    doc: "Log a value to the output panel.",
  },
  {
    label: "ce",
    filterText: "ce console.error error",
    insertText: "console.error($1);",
    snippet: true,
    detail: "console.error(…)",
  },
  {
    label: "cw",
    filterText: "cw console.warn warn",
    insertText: "console.warn($1);",
    snippet: true,
    detail: "console.warn(…)",
  },
  {
    label: "ct",
    filterText: "ct console.table table",
    insertText: "console.table($1);",
    snippet: true,
    detail: "console.table(…)",
  },
  {
    label: "utf-8",
    filterText: "utf utf8 utf-8 encoding",
    insertText: "utf-8",
    detail: "Character encoding",
    doc: "UTF-8 encoding name, often used with TextDecoder or fetch headers.",
  },
  {
    label: "utf8",
    filterText: "utf utf8 utf-8",
    insertText: "utf-8",
    detail: "Insert utf-8",
  },
  {
    label: "TextDecoder utf-8",
    filterText: "textdecoder utf utf8 utf-8",
    insertText: 'new TextDecoder("utf-8").decode($1)',
    snippet: true,
    detail: "Decode bytes as utf-8",
  },
  {
    label: "application/json",
    filterText: "application/json json content-type mime",
    insertText: "application/json",
    detail: "JSON MIME type",
  },
  {
    label: "Content-Type",
    filterText: "content-type header",
    insertText: '"Content-Type": "application/json; charset=utf-8"',
    detail: "JSON utf-8 header",
  },
  {
    label: "fn",
    filterText: "fn function",
    insertText: "function ${1:name}(${2}) {\n  $0\n}",
    snippet: true,
    detail: "function declaration",
  },
  {
    label: "afn",
    filterText: "afn async function",
    insertText: "async function ${1:name}(${2}) {\n  $0\n}",
    snippet: true,
    detail: "async function",
  },
  {
    label: "af",
    filterText: "af arrow function",
    insertText: "(${1}) => $0",
    snippet: true,
    detail: "arrow function",
  },
  {
    label: "forof",
    filterText: "forof for of loop",
    insertText: "for (const ${1:item} of ${2:list}) {\n  $0\n}",
    snippet: true,
    detail: "for…of loop",
  },
  {
    label: "foreach",
    filterText: "foreach forEach",
    insertText: "${1:list}.forEach((${2:item}) => {\n  $0\n});",
    snippet: true,
    detail: "array.forEach",
  },
  {
    label: "map",
    filterText: "map array map",
    insertText: "${1:list}.map((${2:item}) => $0)",
    snippet: true,
    detail: "array.map",
  },
  {
    label: "filter",
    filterText: "filter array",
    insertText: "${1:list}.filter((${2:item}) => $0)",
    snippet: true,
    detail: "array.filter",
  },
  {
    label: "reduce",
    filterText: "reduce array",
    insertText: "${1:list}.reduce((${2:acc}, ${3:item}) => $0, ${4:initial})",
    snippet: true,
    detail: "array.reduce",
  },
  {
    label: "trycatch",
    filterText: "try catch trycatch",
    insertText: "try {\n  $0\n} catch (error) {\n  console.error(error);\n}",
    snippet: true,
    detail: "try / catch",
  },
  {
    label: "fetchjson",
    filterText: "fetch json fetchjson",
    insertText: "const response = await fetch(${1:url});\nconst data = await response.json();\nconsole.log(data);",
    snippet: true,
    detail: "fetch and parse JSON",
  },
  {
    label: "timeout",
    filterText: "timeout setTimeout",
    insertText: "setTimeout(() => {\n  $0\n}, ${1:1000});",
    snippet: true,
    detail: "setTimeout",
  },
  {
    label: "qs",
    filterText: "qs querySelector document",
    insertText: 'document.querySelector("$1")',
    snippet: true,
    detail: "querySelector",
  },
  {
    label: "jsonparse",
    filterText: "json parse jsonparse",
    insertText: "JSON.parse($1)",
    snippet: true,
    detail: "JSON.parse",
  },
  {
    label: "jsonstr",
    filterText: "json stringify jsonstr",
    insertText: "JSON.stringify($1, null, 2)",
    snippet: true,
    detail: "JSON.stringify",
  },
];

export function registerCompletions(monaco) {
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    allowNonTsExtensions: true,
    checkJs: true,
    allowJs: true,
    noEmit: true,
    lib: ["es2022", "dom"],
  });

  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });

  monaco.languages.registerCompletionItemProvider("javascript", {
    triggerCharacters: [".", '"', "'", "`", "-", "/"],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const line = model.getLineContent(position.lineNumber);
      const until = line.slice(0, position.column - 1);
      const token = until.match(/[A-Za-z0-9_./+-]+$/)?.[0] || word.word;
      const startColumn = position.column - token.length;

      const range = new monaco.Range(
        position.lineNumber,
        startColumn,
        position.lineNumber,
        position.column
      );

      const suggestions = SNIPPETS.map((item, index) => ({
        label: item.label,
        kind: item.snippet
          ? monaco.languages.CompletionItemKind.Snippet
          : monaco.languages.CompletionItemKind.EnumMember,
        insertText: item.insertText,
        insertTextRules: item.snippet
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        detail: item.detail,
        documentation: item.doc,
        filterText: item.filterText,
        sortText: String(index).padStart(3, "0"),
        range,
      }));

      return { suggestions };
    },
  });
}
