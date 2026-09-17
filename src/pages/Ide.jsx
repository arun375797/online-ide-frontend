import { useEffect, useRef, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { useAuth } from "../auth.jsx";
import { api } from "../api.js";
import { registerCompletions } from "../lib/completions.js";
import { createRunner } from "../lib/runner.js";
import { defineJellyfishTheme } from "../lib/theme.js";
import { registerJsSyntax } from "../lib/syntax.js";
import { formatEditor, registerFormatters } from "../lib/format.js";
import Brand from "../components/Brand.jsx";
import { LogLine } from "../components/LogValue.jsx";

const MAX_OPEN_BYTES = 1_000_000;
const MAX_LOG_ROWS = 250;
const FONT_MIN = 10;
const FONT_MAX = 28;
const FONT_KEY = "myide.fontSize";
const CHUNK_RELOAD_KEY = "myide.chunk-reload";

function readFontSize(mobile) {
  try {
    const raw = Number(localStorage.getItem(FONT_KEY));
    if (Number.isFinite(raw) && raw >= FONT_MIN && raw <= FONT_MAX) return raw;
  } catch {
    /* ignore */
  }
  return mobile ? 13 : 14;
}

function capRows(rows, row) {
  const next = [...rows, row];
  return next.length > MAX_LOG_ROWS ? next.slice(-MAX_LOG_ROWS) : next;
}

function filesOf(notebook) {
  return Array.isArray(notebook?.files) ? notebook.files : [];
}

function normalizeNotebook(notebook) {
  if (!notebook) return notebook;
  return {
    ...notebook,
    files: filesOf(notebook),
    openFileIds: Array.isArray(notebook.openFileIds) ? notebook.openFileIds : [],
    activeFileId: notebook.activeFileId ?? null,
  };
}

function asSummary(notebook) {
  return {
    _id: notebook._id,
    name: notebook.name,
    updatedAt: notebook.updatedAt,
    fileCount: notebook.fileCount ?? notebook.files?.length ?? 0,
  };
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function languageFor(name) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "json") return "json";
  if (ext === "css") return "css";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "md") return "markdown";
  return "javascript";
}

function uniqueFileName(files, name, exceptId = null) {
  const list = Array.isArray(files) ? files : [];
  const base = name.trim() || "untitled.js";
  const hasExt = /\.[A-Za-z0-9]+$/.test(base);
  const fileName = hasExt ? base : `${base}.js`;
  const taken = new Set(list.filter((f) => f.id !== exceptId).map((f) => f.name.toLowerCase()));
  if (!taken.has(fileName.toLowerCase())) return fileName;
  const match = fileName.match(/^(.*?)(\.[A-Za-z0-9]+)$/);
  const stem = match ? match[1] : fileName;
  const ext = match ? match[2] : "";
  let i = 2;
  while (taken.has(`${stem}-${i}${ext}`.toLowerCase())) i += 1;
  return `${stem}-${i}${ext}`;
}

export default function Ide() {
  const { token, logout } = useAuth();
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);
  const currentRef = useRef(null);
  const saveTimer = useRef(null);
  const runRef = useRef(() => {});
  const formatRef = useRef(() => {});
  const modalRef = useRef(null);
  const dirtyContentRef = useRef({});
  const monacoRef = useRef(null);

  const [notebooks, setNotebooks] = useState([]);
  const [current, setCurrent] = useState(null);
  const [saveState, setSaveState] = useState("Saved");
  const [panel, setPanel] = useState("output");
  const [output, setOutput] = useState([]);
  const [system, setSystem] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null);
  const [modalValue, setModalValue] = useState("");
  const [modalError, setModalError] = useState("");
  const [consoleHeight, setConsoleHeight] = useState(() => (typeof window !== "undefined" && window.innerWidth < 768 ? 128 : 220));
  const [ready, setReady] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  const [fontSize, setFontSize] = useState(() => readFontSize(typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches));

  currentRef.current = current;
  modalRef.current = modal;

  const runnerRef = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => {
      setIsMobile(mq.matches);
      if (!mq.matches) setSidebarOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const instance = createRunner((msg) => {
      const row = { kind: msg.kind, args: msg.args || [], file: msg.file };
      if (msg.kind === "system") {
        setSystem((rows) => capRows(rows, row));
      } else {
        setOutput((rows) => capRows(rows, row));
      }
    });
    runnerRef.current = instance;
    return () => instance.destroy();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loader.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" } });
    loader.init().then((monaco) => {
      if (cancelled) return;
      monacoRef.current = monaco;
      defineJellyfishTheme(monaco);
      registerJsSyntax(monaco);
      registerCompletions(monaco);
      registerFormatters(monaco);
      monaco.editor.setTheme("jellyfish");
      setThemeReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await api("/api/notebooks", { token });
      if (cancelled) return;
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) {
        const created = normalizeNotebook(
          await api("/api/notebooks", { method: "POST", token, body: { name: "Untitled notebook" } })
        );
        if (cancelled) return;
        setNotebooks([asSummary(created)]);
        setCurrent(created);
      } else {
        setNotebooks(rows.map(asSummary));
        const first = rows[0];
        const full = Array.isArray(first.files)
          ? normalizeNotebook(first)
          : normalizeNotebook(await api(`/api/notebooks/${first._id}`, { token }));
        if (cancelled) return;
        setCurrent(full);
      }
      setReady(true);
    })().catch((err) => {
      if (err.status === 401) logout();
      else showToast(err.message);
    });
    return () => {
      cancelled = true;
    };
  }, [token, logout]);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(""), 2200);
  }

  function activeFile(nb = current) {
    if (!nb) return null;
    return filesOf(nb).find((file) => file.id === nb.activeFileId) || null;
  }

  function patchCurrent(updater) {
    setCurrent((prev) => {
      if (!prev) return prev;
      const next = normalizeNotebook(updater({ ...prev, files: filesOf(prev).map((f) => ({ ...f })) }));
      currentRef.current = next;
      setNotebooks((list) => list.map((n) => (n._id === next._id ? asSummary(next) : n)));
      queueSave(next);
      return next;
    });
  }

  function queueSave(notebook) {
    setSaveState("Unsaved");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(notebook), 700);
  }

  async function persist(notebook = currentRef.current, { toast = false } = {}) {
    if (!notebook?._id) return;
    const files = filesOf(notebook).map((f) => ({ ...f }));
    const editor = editorRef.current;
    const active = files.find((f) => f.id === notebook.activeFileId);
    if (active && editor) active.content = editor.getValue();
    for (const [id, content] of Object.entries(dirtyContentRef.current)) {
      const file = files.find((f) => f.id === id);
      if (file) file.content = content;
    }
    dirtyContentRef.current = {};
    try {
      const saved = await api(`/api/notebooks/${notebook._id}`, {
        method: "PUT",
        token,
        body: {
          name: notebook.name,
          files,
          openFileIds: notebook.openFileIds || [],
          activeFileId: notebook.activeFileId,
        },
      });
      const local = normalizeNotebook({ ...saved, files });
      currentRef.current = local;
      setNotebooks((list) => [asSummary(local), ...list.filter((n) => n._id !== local._id)]);
      setSaveState("Saved");
      if (toast) {
        setCurrent(local);
        showToast("Notebook saved to MongoDB.");
      }
    } catch (err) {
      setSaveState("Unsaved");
      if (toast) showToast(err.message || "Could not save.");
    }
  }

  function openFile(fileId) {
    patchCurrent((nb) => {
      const ids = nb.openFileIds || [];
      return {
        ...nb,
        openFileIds: ids.includes(fileId) ? ids : [...ids, fileId],
        activeFileId: fileId,
      };
    });
    setSidebarOpen(false);
  }

  function closeTab(fileId) {
    patchCurrent((nb) => {
      const openFileIds = (nb.openFileIds || []).filter((id) => id !== fileId);
      const activeFileId = nb.activeFileId === fileId ? openFileIds[openFileIds.length - 1] || null : nb.activeFileId;
      return { ...nb, openFileIds, activeFileId };
    });
  }

  async function switchNotebook(id) {
    if (!current || current._id === id) return;
    await persist(current);
    const next = normalizeNotebook(await api(`/api/notebooks/${id}`, { token }));
    dirtyContentRef.current = {};
    setCurrent(next);
    setSidebarOpen(false);
  }

  function openModal(next) {
    setModalError("");
    setModalValue(next.value || "");
    setModal(next);
  }

  async function confirmModal() {
    if (!modal) return;
    if (modal.mode === "delete-file") {
      const id = modal.fileId;
      setModal(null);
      patchCurrent((nb) => {
        const files = filesOf(nb).filter((f) => f.id !== id);
        const openFileIds = (nb.openFileIds || []).filter((fid) => fid !== id);
        const activeFileId = nb.activeFileId === id ? openFileIds[openFileIds.length - 1] || files[0]?.id || null : nb.activeFileId;
        return { ...nb, files, openFileIds, activeFileId };
      });
      return;
    }
    if (modal.mode === "delete-notebook") {
      const id = modal.notebookId;
      setModal(null);
      await api(`/api/notebooks/${id}`, { method: "DELETE", token });
      let nextList = notebooks.filter((n) => n._id !== id);
      if (!nextList.length) {
        const created = await api("/api/notebooks", { method: "POST", token, body: { name: "Untitled notebook" } });
        nextList = [created];
      }
      setNotebooks(nextList.map(asSummary));
      const full = Array.isArray(nextList[0].files)
        ? normalizeNotebook(nextList[0])
        : normalizeNotebook(await api(`/api/notebooks/${nextList[0]._id}`, { token }));
      dirtyContentRef.current = {};
      setCurrent(full);
      return;
    }
    const value = modalValue.trim();
    if (!value) {
      setModalError("Please enter a name.");
      return;
    }
    if (modal.mode === "file") {
      const name = uniqueFileName(filesOf(current), value);
      const file = { id: uid(), name, content: "" };
      setModal(null);
      patchCurrent((nb) => ({
        ...nb,
        files: [...filesOf(nb), file],
        openFileIds: [...(nb.openFileIds || []), file.id],
        activeFileId: file.id,
      }));
      return;
    }
    if (modal.mode === "rename") {
      setModal(null);
      patchCurrent((nb) => ({
        ...nb,
        files: filesOf(nb).map((f) => (f.id === modal.fileId ? { ...f, name: uniqueFileName(filesOf(nb), value, f.id) } : f)),
      }));
      return;
    }
    if (modal.mode === "notebook") {
      setModal(null);
      await persist(current);
      const created = normalizeNotebook(await api("/api/notebooks", { method: "POST", token, body: { name: value } }));
      dirtyContentRef.current = {};
      setNotebooks((list) => [asSummary(created), ...list]);
      setCurrent(created);
    }
  }

  function runCurrentFile() {
    const file = activeFile();
    if (!file) {
      showToast("Open or create a file first.");
        setSystem((rows) => capRows(rows, { kind: "system", text: "Run skipped: no file is open." }));
      setPanel("system");
      return;
    }
    const code = editorRef.current ? editorRef.current.getValue() : file.content;
    setOutput([]);
    setPanel("output");
    setSystem((rows) => capRows(rows, { kind: "system", text: `Ran ${file.name}` }));
    runnerRef.current?.run(code, file.name);
  }

  runRef.current = runCurrentFile;

  async function formatCurrentFile() {
    const file = activeFile(currentRef.current);
    if (!file || !editorRef.current) {
      showToast("Open a file to format.");
      return;
    }
    const changed = await formatEditor(editorRef.current, languageFor(file.name));
    if (changed) {
      dirtyContentRef.current[file.id] = editorRef.current.getValue();
      setSaveState("Unsaved");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => persist(currentRef.current), 400);
      showToast("Code organized.");
    } else {
      showToast("Already formatted, or the code has a syntax error.");
    }
  }

  formatRef.current = formatCurrentFile;

  function bumpFont(delta) {
    setFontSize((n) => {
      const next = Math.min(FONT_MAX, Math.max(FONT_MIN, n + delta));
      try {
        localStorage.setItem(FONT_KEY, String(next));
      } catch {
        /* ignore */
      }
      editorRef.current?.updateOptions({ fontSize: next });
      return next;
    });
  }

  async function importLocalFiles(fileList) {
    if (!current || !fileList?.length) return;
    const additions = [];
    for (const diskFile of fileList) {
      if (diskFile.size > MAX_OPEN_BYTES) {
        showToast(`${diskFile.name} is larger than 1 MB.`);
        setSystem((rows) => capRows(rows, { kind: "system", text: `Could not open ${diskFile.name}: file is larger than 1 MB.` }));
        continue;
      }
      const content = await diskFile.text();
      additions.push({ id: uid(), name: uniqueFileName([...filesOf(current), ...additions], diskFile.name), content });
    }
    if (!additions.length) return;
    patchCurrent((nb) => ({
      ...nb,
      files: [...filesOf(nb), ...additions],
      openFileIds: [...(nb.openFileIds || []), ...additions.map((f) => f.id)],
      activeFileId: additions[additions.length - 1].id,
    }));
    additions.forEach((file) => {
      setSystem((rows) => capRows(rows, { kind: "system", text: `Opened ${file.name} into this notebook.` }));
    });
  }

  useEffect(() => {
    function onKey(event) {
      const key = event.key.toLowerCase();
      if (event.key === "Escape") {
        setMenuOpen(false);
        setModal(null);
        setSidebarOpen(false);
      }
      if ((event.ctrlKey || event.metaKey) && key === "s") {
        event.preventDefault();
        persist(currentRef.current, { toast: true });
      }
      if ((event.ctrlKey || event.metaKey) && key === "o") {
        event.preventDefault();
        fileInputRef.current?.click();
      }
      if ((event.ctrlKey || event.metaKey) && key === "n") {
        event.preventDefault();
        openModal({ mode: "file", title: "New file", copy: "This file will open in a tab.", ok: "Create", value: "untitled.js" });
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === "f") {
        event.preventDefault();
        event.stopPropagation();
        formatRef.current();
        return;
      }
      if (event.altKey && event.shiftKey && key === "f") {
        event.preventDefault();
        event.stopPropagation();
        formatRef.current();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        if (modalRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        runRef.current();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const notebookFiles = filesOf(current);
  const file = activeFile();
  const openTabs = (current?.openFileIds || []).map((id) => notebookFiles.find((f) => f.id === id)).filter(Boolean);

  if (!ready || !current) {
    return <div className="grid h-full place-items-center bg-deep text-muted">Loading notebooks…</div>;
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_1fr] bg-deep text-white md:grid-cols-[min(260px,32vw)_1fr]">
      <header className="col-span-full flex flex-col border-b border-cyan/20 bg-darker pt-[env(safe-area-inset-top)]">
        <div className="flex min-h-12 min-w-0 flex-wrap items-center gap-2 px-2 py-1.5 md:min-h-[58px] md:gap-4 md:px-4">
          <button
            type="button"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-cyan/20 text-lg md:hidden"
            onClick={() => { setSidebarOpen((v) => !v); setMenuOpen(false); }}
            aria-label="Toggle notebooks"
          >
            ☰
          </button>
          <Brand />
          <div className="relative shrink-0">
            <button type="button" className={`rounded-md px-2 py-1.5 text-sm md:px-3 ${menuOpen ? "bg-cyan/15 text-cyan" : "hover:bg-cyan/10"}`} onClick={() => setMenuOpen((v) => !v)}>
              File
            </button>
            {menuOpen ? (
              <div className="absolute left-0 top-full z-40 mt-2 w-56 rounded-xl border border-cyan/20 bg-widget p-1.5 shadow-glow">
                <MenuItem label="New File" kbd="Ctrl+N" onClick={() => { setMenuOpen(false); openModal({ mode: "file", title: "New file", copy: "This file will open in a tab.", ok: "Create", value: uniqueFileName(notebookFiles, "untitled.js") }); }} />
                <MenuItem label="New Notebook" onClick={() => { setMenuOpen(false); openModal({ mode: "notebook", title: "New notebook", copy: "A new notebook starts empty.", ok: "Create", value: "Untitled notebook" }); }} />
                <MenuItem label="Open File…" kbd="Ctrl+O" onClick={() => { setMenuOpen(false); fileInputRef.current?.click(); }} />
                <hr className="my-1 border-cyan/15" />
                <MenuItem label="Save" kbd="Ctrl+S" onClick={() => { setMenuOpen(false); persist(current, { toast: true }); }} />
                <MenuItem label="Organize" onClick={() => { setMenuOpen(false); formatCurrentFile(); }} />
                <MenuItem label="Log out" onClick={() => { setMenuOpen(false); logout(); }} />
              </div>
            ) : null}
          </div>
          <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
            <input
              className="w-full max-w-md bg-transparent text-base font-semibold outline-none border-b border-transparent focus:border-cyan"
              value={current.name}
              onChange={(e) => patchCurrent((nb) => ({ ...nb, name: e.target.value }))}
            />
            <span className={`text-xs ${saveState === "Saved" ? "text-lime" : "text-yellow"}`}>{saveState}</span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2">
            <button type="button" className="hidden rounded-lg border border-cyan/20 px-3 py-2 text-sm hover:border-cyan md:inline" onClick={() => openModal({ mode: "notebook", title: "New notebook", copy: "A new notebook starts empty.", ok: "Create", value: "Untitled notebook" })}>
              New notebook
            </button>
            <button type="button" className="hidden rounded-lg border border-cyan/20 px-3 py-2 text-sm hover:border-cyan md:inline" onClick={() => persist(current, { toast: true })}>Save</button>
            <button
              type="button"
              className="rounded-lg border border-cyan/20 px-3 py-2 text-sm font-semibold hover:border-cyan hover:text-cyan"
              onClick={formatCurrentFile}
              title="Organize code"
            >
              O
            </button>
            <div className="inline-flex overflow-hidden rounded-lg border border-cyan/20">
              <button
                type="button"
                className="px-2.5 py-2 text-sm leading-none hover:bg-cyan/10 hover:text-cyan disabled:opacity-35"
                onClick={() => bumpFont(-1)}
                disabled={fontSize <= FONT_MIN}
                title="Smaller text"
                aria-label="Decrease font size"
              >
                −
              </button>
              <span className="hidden min-w-[2rem] items-center justify-center border-x border-cyan/20 text-[11px] text-muted sm:flex">{fontSize}</span>
              <button
                type="button"
                className="px-2.5 py-2 text-sm leading-none hover:bg-cyan/10 hover:text-cyan disabled:opacity-35"
                onClick={() => bumpFont(1)}
                disabled={fontSize >= FONT_MAX}
                title="Larger text"
                aria-label="Increase font size"
              >
                +
              </button>
            </div>
            <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-lime px-3 py-2 text-sm font-semibold text-deep" onClick={runCurrentFile} title="Ctrl+Enter">
              Run
              <span className="hidden text-[10px] font-medium opacity-70 lg:inline">Ctrl+Enter</span>
            </button>
            <button type="button" className="hidden rounded-lg border border-cyan/20 px-3 py-2 text-sm hover:border-pink hover:text-pink md:inline" onClick={logout}>
              Log out
            </button>
          </div>
        </div>
        <div className="flex h-9 min-w-0 items-center gap-2 border-t border-cyan/10 px-3 md:hidden">
          <input
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
            value={current.name}
            onChange={(e) => patchCurrent((nb) => ({ ...nb, name: e.target.value }))}
            aria-label="Notebook name"
          />
          <span className={`shrink-0 text-[11px] ${saveState === "Saved" ? "text-lime" : "text-yellow"}`}>{saveState}</span>
        </div>
        {sidebarOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-20 bg-black/50 md:hidden"
            aria-label="Close notebooks"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}
      </header>

      <div className="max-md:pointer-events-none max-md:col-start-1 max-md:row-start-1 max-md:h-0 max-md:w-0 max-md:overflow-visible md:contents">
      <aside className={`pointer-events-auto flex h-full min-h-0 flex-col border-r border-cyan/20 bg-deep max-md:fixed max-md:bottom-0 max-md:left-0 max-md:top-[calc(env(safe-area-inset-top)+5.25rem)] max-md:z-30 max-md:w-[min(18rem,88vw)] max-md:shadow-glow max-md:transition-transform max-md:duration-200 ${sidebarOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"} pb-[env(safe-area-inset-bottom)] md:relative md:w-auto md:translate-x-0 md:shadow-none`}>
        <section className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Notebooks</h2>
            <button type="button" className="h-8 w-8 rounded border border-cyan/20 text-lg hover:border-cyan hover:text-cyan" onClick={() => openModal({ mode: "notebook", title: "New notebook", copy: "A new notebook starts empty.", ok: "Create", value: "Untitled notebook" })}>+</button>
          </div>
          <ul>
            {notebooks.map((nb) => (
              <li key={nb._id}>
                <SideItem
                  active={nb._id === current._id}
                  label={nb.name}
                  meta={nb.fileCount ?? nb.files?.length ?? 0}
                  onClick={() => switchNotebook(nb._id)}
                  onDelete={() => openModal({ mode: "delete-notebook", title: "Delete notebook?", copy: `Delete “${nb.name}” and every file inside it? This cannot be undone.`, ok: "Delete", danger: true, notebookId: nb._id })}
                />
              </li>
            ))}
          </ul>
        </section>
        <section className="flex min-h-0 flex-1 flex-col p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Files</h2>
            <div className="flex gap-1">
              <button type="button" className="h-8 rounded border border-cyan/20 px-2 text-xs hover:border-cyan hover:text-cyan" onClick={() => fileInputRef.current?.click()}>Open</button>
              <button type="button" className="h-8 w-8 rounded border border-cyan/20 text-lg hover:border-cyan hover:text-cyan" onClick={() => openModal({ mode: "file", title: "New file", copy: "This file will open in a tab.", ok: "Create", value: uniqueFileName(notebookFiles, "untitled.js") })}>+</button>
            </div>
          </div>
          <ul className="flex-1 overflow-auto">
            {notebookFiles.map((item) => (
              <li key={item.id}>
                <SideItem
                  active={item.id === current.activeFileId}
                  label={item.name}
                  onClick={() => openFile(item.id)}
                  onDelete={() => openModal({ mode: "delete-file", title: "Delete file?", copy: `Delete “${item.name}”? This cannot be undone.`, ok: "Delete", danger: true, fileId: item.id })}
                />
              </li>
            ))}
          </ul>
        </section>
      </aside>
      </div>

      <main className="flex min-h-0 min-w-0 flex-col bg-panel">
        <div className="flex min-h-10 items-stretch border-b border-cyan/20 bg-deep">
          <div className="flex flex-1 overflow-x-auto [-webkit-overflow-scrolling:touch]">
            {openTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`flex shrink-0 items-center gap-2 border-r border-cyan/20 px-3 py-2 font-mono text-[13px] ${tab.id === current.activeFileId ? "bg-panel text-white shadow-[inset_0_2px_0_#00ffff]" : "text-muted"}`}
                onClick={() => openFile(tab.id)}
                onDoubleClick={() => openModal({ mode: "rename", title: "Rename file", copy: "The file stays open; only the name changes.", ok: "Rename", value: tab.name, fileId: tab.id })}
              >
                {tab.name}
                <span
                  className="grid h-7 w-7 place-items-center text-muted hover:text-danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="m-1.5 hidden rounded border border-cyan/20 px-2 text-xs hover:border-cyan sm:inline" onClick={() => fileInputRef.current?.click()}>Open</button>
          <button type="button" className="m-1.5 rounded border border-cyan/20 px-2 text-xs font-semibold hover:border-cyan hover:text-cyan" onClick={formatCurrentFile} title="Organize code">O</button>
          <button type="button" className="m-1.5 mr-2 h-8 w-8 rounded border border-cyan/20 hover:border-cyan" onClick={() => openModal({ mode: "file", title: "New file", copy: "This file will open in a tab.", ok: "Create", value: uniqueFileName(notebookFiles, "untitled.js") })}>+</button>
        </div>

        <div className="relative min-h-0 flex-1">
          {file && themeReady ? (
            <Editor
              height="100%"
              theme="jellyfish"
              language={languageFor(file.name)}
              path={`${current._id}/${file.id}/${file.name}`}
              defaultValue={file.content}
              loading={<div className="h-full w-full bg-panel" />}
              beforeMount={(monacoInstance) => {
                defineJellyfishTheme(monacoInstance);
                registerJsSyntax(monacoInstance);
                registerCompletions(monacoInstance);
                registerFormatters(monacoInstance);
                monacoInstance.editor.setTheme("jellyfish");
              }}
              onMount={(editor, monacoInstance) => {
                editorRef.current = editor;
                monacoInstance.editor.setTheme("jellyfish");
                editor.updateOptions({
                  fontSize,
                  matchBrackets: "never",
                  selectionHighlight: false,
                  occurrencesHighlight: "off",
                  snippetSuggestions: "none",
                  cursorStyle: "line",
                  guides: {
                    bracketPairs: true,
                    bracketPairsHorizontal: "active",
                    highlightActiveBracketPair: true,
                    highlightActiveIndentation: false,
                    indentation: false,
                  },
                  bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: false },
                });
                editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => runRef.current());
                editor.addCommand(monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.KeyF, () => formatRef.current());
                editor.addCommand(monacoInstance.KeyMod.Alt | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyF, () => formatRef.current());
              }}
              onChange={(value) => {
                dirtyContentRef.current[file.id] = value ?? "";
                setSaveState((state) => (state === "Unsaved" ? state : "Unsaved"));
                clearTimeout(saveTimer.current);
                saveTimer.current = setTimeout(() => persist(currentRef.current), 700);
              }}
              options={{
                fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
                fontSize,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                tabSize: 2,
                padding: { top: isMobile ? 8 : 12 },
                automaticLayout: true,
                suggestOnTriggerCharacters: true,
                quickSuggestions: { other: true, comments: false, strings: true },
                quickSuggestionsDelay: 200,
                acceptSuggestionOnEnter: "smart",
                tabCompletion: "off",
                snippetSuggestions: "none",
                wordBasedSuggestions: "off",
                occurrencesHighlight: "off",
                selectionHighlight: false,
                cursorStyle: "line",
                cursorBlinking: "smooth",
                renderControlCharacters: false,
                unicodeHighlight: {
                  ambiguousCharacters: false,
                  invisibleCharacters: false,
                  nonBasicASCII: false,
                },
                inlayHints: { enabled: "off" },
                "semanticHighlighting.enabled": true,
                suggest: {
                  showSnippets: false,
                  snippetsPreventQuickSuggestions: true,
                },
                renderWhitespace: "none",
                renderValidationDecorations: "off",
                parameterHints: { enabled: false },
                matchBrackets: "never",
                bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: false },
                guides: {
                  bracketPairs: true,
                  bracketPairsHorizontal: "active",
                  highlightActiveBracketPair: true,
                  highlightActiveIndentation: false,
                  indentation: false,
                },
                smoothScrolling: false,
                links: false,
                hover: { delay: 250 },
                largeFileOptimizations: true,
                wordWrap: isMobile ? "on" : "off",
                lineNumbersMinChars: isMobile ? 3 : 5,
                folding: !isMobile,
                glyphMargin: false,
                mouseWheelZoom: false,
              }}
            />
          ) : file ? (
            <div className="h-full w-full bg-panel" />
          ) : (
            <div className="grid h-full place-content-center justify-items-center gap-2 bg-panel px-4 text-center text-muted">
              <p>{notebookFiles.length ? "No file is open." : "This notebook is empty."}</p>
              <p className="mb-2 text-sm">{notebookFiles.length ? "Open a file from the sidebar, or use File → Open File." : "Create a file or open one from your computer."}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className="rounded-lg border border-cyan/20 px-3 py-2 text-sm" onClick={() => fileInputRef.current?.click()}>Open file</button>
                <button type="button" className="rounded-lg bg-lime px-3 py-2 text-sm font-semibold text-deep" onClick={() => openModal({ mode: "file", title: "New file", copy: "This file will open in a tab.", ok: "Create", value: uniqueFileName(notebookFiles, "untitled.js") })}>New file</button>
              </div>
            </div>
          )}
        </div>

        <div className="relative flex flex-col border-t border-cyan/20 bg-overlay pb-[env(safe-area-inset-bottom)]" style={{ height: consoleHeight }}>
          <div
            className="absolute -top-2 left-0 right-0 z-10 h-4 touch-none cursor-ns-resize"
            onPointerDown={(event) => {
              event.preventDefault();
              const startY = event.clientY;
              const startH = consoleHeight;
              const move = (ev) => {
                const min = isMobile ? 96 : 110;
                const max = window.innerHeight * (isMobile ? 0.42 : 0.55);
                setConsoleHeight(Math.min(Math.max(startH + (startY - ev.clientY), min), max));
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          />
          <div className="flex items-center justify-between px-3 pt-1">
            <div className="flex gap-1">
              <button type="button" className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide ${panel === "output" ? "border-b-2 border-cyan text-cyan" : "text-muted"}`} onClick={() => setPanel("output")}>Output</button>
              <button type="button" className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide ${panel === "system" ? "border-b-2 border-cyan text-cyan" : "text-muted"}`} onClick={() => setPanel("system")}>System</button>
            </div>
            <button type="button" className="text-xs text-muted hover:text-white" onClick={() => (panel === "output" ? setOutput([]) : setSystem([]))}>Clear</button>
          </div>
          <div className="flex-1 overflow-auto px-3 pb-3">
            {(panel === "output" ? output : system).length === 0 ? (
              <div className="px-1 pt-2 text-xs text-muted">{panel === "output" ? "Output from the current file will show up here." : "System messages will show up here."}</div>
            ) : (
              (panel === "output" ? output : system).map((row, i) => <LogLine key={i} row={row} />)
            )}
          </div>
        </div>
      </main>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".js,.mjs,.cjs,.json,.txt,.html,.htm,.css,.md"
        className="hidden"
        onChange={(event) => {
          importLocalFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {modal ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-deep/70 p-0 sm:place-items-center sm:p-4" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className={`w-full rounded-t-2xl border bg-widget p-5 shadow-glow sm:w-[min(420px,calc(100%-32px))] sm:rounded-2xl ${modal.danger ? "border-danger/50" : "border-cyan/20"} pb-[max(1.25rem,env(safe-area-inset-bottom))]`}>
            <h3 className="mb-1 text-lg font-semibold">{modal.title}</h3>
            <p className="mb-4 text-sm text-muted">{modal.copy}</p>
            {modal.danger ? null : (
              <input
                autoFocus
                className="w-full rounded-lg border border-cyan/20 bg-overlay px-3 py-2 font-mono outline-none focus:border-cyan"
                value={modalValue}
                onChange={(e) => setModalValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmModal()}
              />
            )}
            {modalError ? <p className="mt-2 text-sm text-danger">{modalError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-cyan/20 px-3 py-2 text-sm" onClick={() => setModal(null)}>Cancel</button>
              <button type="button" className={`rounded-lg px-3 py-2 text-sm font-semibold ${modal.danger ? "bg-danger text-white" : "bg-lime text-deep"}`} onClick={confirmModal}>
                {modal.ok}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 z-40 rounded-xl border border-cyan/20 bg-widget px-4 py-2 text-sm shadow-glow sm:left-auto sm:right-4 sm:w-auto">{toast}</div> : null}
    </div>
  );
}

function MenuItem({ label, kbd, onClick }) {
  return (
    <button type="button" className="flex min-h-11 w-full items-center justify-between rounded-lg px-2.5 py-2.5 text-left text-sm hover:bg-cyan/10 hover:text-cyan" onClick={onClick}>
      <span>{label}</span>
      {kbd ? <span className="hidden text-[11px] text-muted sm:inline">{kbd}</span> : null}
    </button>
  );
}

function SideItem({ active, label, meta, onClick, onDelete }) {
  return (
    <button type="button" className={`mb-1 flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left text-sm ${active ? "bg-cyan/15 text-cyan" : "hover:bg-widget"}`} onClick={onClick}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta != null ? <span className="text-[11px] text-muted">{meta}</span> : null}
      <span
        className="grid h-8 w-8 shrink-0 place-items-center text-muted hover:text-danger"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        ×
      </span>
    </button>
  );
}
