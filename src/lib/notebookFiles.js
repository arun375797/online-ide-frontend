export function uniqueFileName(files, name, exceptId = null) {
  const list = Array.isArray(files) ? files : [];
  const base = name.trim() || "untitled.js";
  const hasExt = /\.[A-Za-z0-9]+$/.test(base);
  const fileName = hasExt ? base : `${base}.js`;
  const taken = new Set(
    list
      .filter((file) => file.id !== exceptId)
      .map((file) => file.name.toLowerCase()),
  );
  if (!taken.has(fileName.toLowerCase())) return fileName;
  const match = fileName.match(/^(.*?)(\.[A-Za-z0-9]+)$/);
  const stem = match ? match[1] : fileName;
  const ext = match ? match[2] : "";
  let index = 2;
  while (taken.has(`${stem}-${index}${ext}`.toLowerCase())) index += 1;
  return `${stem}-${index}${ext}`;
}

/** Keep IDs, open tabs, and unsaved source intact when Monaco changes model paths. */
export function renameNotebookFile(
  notebook,
  fileId,
  name,
  unsavedContents = {},
) {
  if (!name.trim()) throw new Error("Please enter a name.");
  const files = Array.isArray(notebook.files) ? notebook.files : [];
  if (!files.some((file) => file.id === fileId))
    throw new Error("This file no longer exists.");
  const nextName = uniqueFileName(files, name, fileId);
  return {
    ...notebook,
    files: files.map((file) => ({
      ...file,
      ...(Object.hasOwn(unsavedContents, file.id)
        ? { content: unsavedContents[file.id] }
        : {}),
      ...(file.id === fileId ? { name: nextName } : {}),
    })),
  };
}
