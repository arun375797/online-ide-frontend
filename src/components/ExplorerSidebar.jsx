export function ExplorerIcon({ name, size = 16 }) {
  const paths = {
    folder:
      "M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z",
    file: "M14 3H5v18h14V8l-5-5ZM14 3v6h5M8 13h8M8 17h5",
    plus: "M12 5v14M5 12h14",
    open: "M12 15V3m-4 4 4-4 4 4M5 14v6h14v-6",
    trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6",
    rename: "m15 5 4 4M4 20l5-1L21 7a2.8 2.8 0 0 0-4-4L5 15l-1 5Z",
    format: "m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.file} />
    </svg>
  );
}

function FileBadge({ name }) {
  const extension = name.split(".").pop()?.toLowerCase();
  const types = {
    js: ["JS", "javascript"],
    mjs: ["JS", "javascript"],
    cjs: ["JS", "javascript"],
    json: ["{}", "json"],
    css: ["#", "css"],
    html: ["<>", "html"],
    htm: ["<>", "html"],
    md: ["M", "markdown"],
  };
  const type = types[extension];
  return type ? (
    <span className={`ide-file-badge ide-file-${type[1]}`} aria-hidden="true">
      {type[0]}
    </span>
  ) : (
    <ExplorerIcon name="file" />
  );
}

function ExplorerRow({
  active,
  label,
  meta,
  kind,
  onOpen,
  onRename,
  onDelete,
}) {
  return (
    <li className={`ide-explorer-row${active ? " is-active" : ""}`}>
      <button
        type="button"
        className="ide-explorer-open"
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "F2") {
            event.preventDefault();
            onRename();
          }
        }}
        title={label}
        aria-current={active ? "true" : undefined}
        aria-keyshortcuts="F2"
      >
        {kind === "notebook" ? (
          <ExplorerIcon name="folder" />
        ) : (
          <FileBadge name={label} />
        )}
        <span className="ide-explorer-label">{label}</span>
        {meta != null && (
          <span className="ide-explorer-count" aria-label={`${meta} files`}>
            {meta}
          </span>
        )}
      </button>
      <button
        type="button"
        className="ide-row-rename"
        title={`Rename ${kind} (F2)`}
        aria-label={`Rename ${kind} ${label}`}
        onClick={onRename}
      >
        <ExplorerIcon name="rename" size={13} />
      </button>
      <button
        type="button"
        className="ide-row-delete"
        title={`Delete ${kind}`}
        aria-label={`Delete ${kind} ${label}`}
        onClick={onDelete}
      >
        <ExplorerIcon name="trash" size={13} />
      </button>
    </li>
  );
}

export default function ExplorerSidebar({
  notebooks,
  current,
  onSelectNotebook,
  onSelectFile,
  onNewNotebook,
  onNewFile,
  onOpenFiles,
  onDeleteNotebook,
  onDeleteFile,
  onRenameNotebook,
  onRenameFile,
}) {
  const files = Array.isArray(current?.files) ? current.files : [];
  return (
    <div className="ide-explorer">
      <section
        className="ide-explorer-section ide-notebooks-section"
        aria-labelledby="ide-notebooks-title"
      >
        <div className="ide-section-heading">
          <h2 id="ide-notebooks-title">
            Notebooks <span>{notebooks.length}</span>
          </h2>
          <button
            type="button"
            className="ide-explorer-action"
            onClick={onNewNotebook}
            title="New notebook"
            aria-label="New notebook"
          >
            <ExplorerIcon name="plus" size={15} />
          </button>
        </div>
        <ul className="ide-explorer-list" aria-label="Notebooks">
          {notebooks.map((notebook) => (
            <ExplorerRow
              key={notebook._id}
              kind="notebook"
              active={notebook._id === current._id}
              label={notebook.name}
              meta={notebook.fileCount ?? notebook.files?.length ?? 0}
              onOpen={() => onSelectNotebook(notebook._id)}
              onRename={() => onRenameNotebook(notebook)}
              onDelete={() => onDeleteNotebook(notebook)}
            />
          ))}
        </ul>
      </section>

      <section
        className="ide-explorer-section ide-files-section"
        aria-labelledby="ide-files-title"
      >
        <div className="ide-section-heading">
          <h2 id="ide-files-title">
            Files <span>{files.length}</span>
          </h2>
          <div className="ide-section-actions">
            <button
              type="button"
              className="ide-explorer-action ide-open-files"
              onClick={onOpenFiles}
              title="Open files from your computer"
            >
              <ExplorerIcon name="open" size={14} />
              <span>Open</span>
            </button>
            <button
              type="button"
              className="ide-explorer-action"
              onClick={onNewFile}
              title="New file"
              aria-label="New file"
            >
              <ExplorerIcon name="plus" size={15} />
            </button>
          </div>
        </div>
        <div className="ide-file-context" title={current.name}>
          <ExplorerIcon name="folder" size={12} />
          <span>{current.name}</span>
        </div>
        <ul
          className="ide-explorer-list"
          aria-label={`Files in ${current.name}`}
        >
          {files.map((file) => (
            <ExplorerRow
              key={file.id}
              kind="file"
              active={file.id === current.activeFileId}
              label={file.name}
              onOpen={() => onSelectFile(file.id)}
              onRename={() => onRenameFile(file)}
              onDelete={() => onDeleteFile(file)}
            />
          ))}
        </ul>
        {!files.length && (
          <div className="ide-explorer-empty">
            <ExplorerIcon name="file" size={24} />
            <p>No files in this notebook</p>
            <button type="button" onClick={onNewFile}>
              Create your first file
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
