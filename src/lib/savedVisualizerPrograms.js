/** Keep notebook/file IDs in each option so repeated names remain distinct. */
export function savedVisualizerPrograms(notebooks) {
  if (!Array.isArray(notebooks)) return [];
  return notebooks
    .filter((notebook) => notebook?._id != null)
    .map((notebook) => {
      const notebookId = String(notebook._id);
      const notebookName = notebook.name || "Untitled notebook";
      return {
        id: notebookId,
        name: notebookName,
        programs: (Array.isArray(notebook.files) ? notebook.files : [])
          .filter(
            (file) =>
              file?.id != null && /\.(?:js|mjs|cjs)$/i.test(file.name || ""),
          )
          .map((file) => ({
            key: `saved:${JSON.stringify([notebookId, String(file.id)])}`,
            notebookId,
            notebookName,
            fileName: file.name,
            source: typeof file.content === "string" ? file.content : "",
          })),
      };
    });
}
