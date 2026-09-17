const PARSER = {
  javascript: "babel",
  json: "json",
  css: "css",
  html: "html",
  markdown: "markdown",
};

async function pluginsFor(parser) {
  if (parser === "babel" || parser === "json") {
    const [babel, estree] = await Promise.all([
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
    ]);
    return [babel, estree];
  }
  if (parser === "css") {
    const postcss = await import("prettier/plugins/postcss");
    return [postcss];
  }
  if (parser === "html") {
    const html = await import("prettier/plugins/html");
    return [html];
  }
  if (parser === "markdown") {
    const markdown = await import("prettier/plugins/markdown");
    return [markdown];
  }
  return [];
}

export async function formatSource(code, language) {
  const parser = PARSER[language] || PARSER[languageForFallback(language)];
  if (!parser || !code) return code;
  try {
    const mod = await import("prettier/standalone");
    const format = mod.format || mod.default?.format;
    if (!format) return code;
    const plugins = await pluginsFor(parser);
    return await format(code, {
      parser,
      plugins,
      semi: true,
      singleQuote: false,
      tabWidth: 2,
      printWidth: 80,
      trailingComma: "es5",
      bracketSpacing: true,
      arrowParens: "always",
      endOfLine: "lf",
    });
  } catch {
    return code;
  }
}

function languageForFallback(language) {
  if (language === "javascript" || language === "json" || language === "css" || language === "html" || language === "markdown") {
    return language;
  }
  return "";
}

let registered = false;

export function registerFormatters(monaco) {
  if (registered) return;
  registered = true;

  const languages = ["javascript", "json", "css", "html", "markdown"];
  for (const language of languages) {
    monaco.languages.registerDocumentFormattingEditProvider(language, {
      async provideDocumentFormattingEdits(model) {
        const text = model.getValue();
        const formatted = await formatSource(text, language);
        if (formatted === text) return [];
        return [
          {
            range: model.getFullModelRange(),
            text: formatted,
          },
        ];
      },
    });
  }
}

export async function formatEditor(editor, language) {
  if (!editor) return false;
  const text = editor.getValue();
  const formatted = await formatSource(text, language);
  if (formatted === text) return false;
  const selection = editor.getSelection();
  editor.pushUndoStop();
  editor.executeEdits("format", [
    {
      range: editor.getModel().getFullModelRange(),
      text: formatted,
    },
  ]);
  editor.pushUndoStop();
  if (selection) editor.setSelection(selection);
  return true;
}
