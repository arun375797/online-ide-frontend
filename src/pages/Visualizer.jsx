import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { defineVisualizerTheme } from "../lib/theme.js";
import { learningStepIndices } from "../lib/executionLesson.js";
import ExecutionHistory from "../components/ExecutionHistory.jsx";
import Brand from "../components/Brand.jsx";
import VisualizerBrand from "../components/VisualizerBrand.jsx";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { savedVisualizerPrograms } from "../lib/savedVisualizerPrograms.js";
import "../memoryVisualizer.css";

const SOURCE_KEY = "myide.visualizer.source";
const TRACE_TIMEOUT_MS = 6_000;
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const ZERO_DEMO = `let arr = [1, 0, 2, 0, 3, 0, 0, 4, 5];

for (let i = 0; i < arr.length; i++) {
  if (arr[i] === 0) {
    arr.splice(i, 1);
    i--;
  }
}
console.log(arr);`;
const ARRAY_DEMO = `let arr = [10, 20, 30, 40, 50];
let n = 3;

if (n >= 1 && n <= arr.length) {
  for (let i = n - 1; i < arr.length - 1; i++) {
    arr[i] = arr[i + 1];
  }

  arr.length--;
}

console.log(arr);`;

const DEMO = `// First matrix
const A = [
  [4, 8, 12],
  [5, 10, 15]
];

// Second matrix
const B = [
  [7, 14, 21],
  [9, 16, 24]
];

// Add the two matrices
const sum = [];

for (let i = 0; i < A.length; i++) {
  sum[i] = [];

  for (let j = 0; j < A[i].length; j++) {
    sum[i][j] = A[i][j] + B[i][j];
  }
}

// Print the result row by row
for (let i = 0; i < sum.length; i++) {
  let row = "";

  for (let j = 0; j < sum[i].length; j++) {
    row += sum[i][j] + " ";
  }

  console.log(row);
}`;
const EXAMPLES = [
  { name: "Remove zeros", source: ZERO_DEMO },
  { name: "Adding two matrices", source: DEMO },
  { name: "Array deletion", source: ARRAY_DEMO },
  {
    name: "Remove spaces",
    source: `let str = "hello world javascript";
for (let i = 0; i < str.length; i++) {
  if (str[i] === " ") {
    str = str.replace(" ", "");
    i--;
  }
}
console.log(str);`,
  },
  {
    name: "Prime check",
    source: `function isPrime(num) {
  if (num < 2) return false;
  for (let i = 2; i * i <= num; i++) {
    if (num % i === 0) return false;
  }
  return true;
}

console.log(isPrime(4));`,
  },
  {
    name: "Running total",
    source: `let total = 0;
for (let i = 1; i <= 5; i++) {
  total += i;
  console.log(total);
}`,
  },
];
function initialSource() {
  try {
    const source = sessionStorage.getItem(SOURCE_KEY) || "";
    return source || ZERO_DEMO;
  } catch {
    return ZERO_DEMO;
  }
}

function Icon({ name, size = 18 }) {
  const paths = {
    play: "m9 5 11 7-11 7V5Z",
    pause: "M8 5v14M16 5v14",
    back: "m14 6-6 6 6 6",
    next: "m10 6 6 6-6 6",
    restart: "M3 10a9 9 0 1 1 2 9M3 4v6h6",
    code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16",
    arrow: "M19 12H5m6-6-6 6 6 6",
    expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.code} />
    </svg>
  );
}

export default function Visualizer() {
  const { token, logout } = useAuth();
  const [source, setSource] = useState(initialSource);
  const [openedFile, setOpenedFile] = useState(null);
  const [library, setLibrary] = useState({
    groups: [],
    loading: true,
    error: "",
  });
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [trace, setTrace] = useState(null);
  const [traceError, setTraceError] = useState("");
  const [activeStep, setActiveStep] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [guided, setGuided] = useState(true);
  const [breakpoints, setBreakpoints] = useState([]);
  const [focused, setFocused] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [editorMounted, setEditorMounted] = useState(false);
  const [editorFailed, setEditorFailed] = useState(false);
  const [tracing, setTracing] = useState(false);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationsRef = useRef([]);
  const traceWorkerRef = useRef(null);
  const traceTimeoutRef = useRef(null);

  const steps = useMemo(() => trace?.events ?? [], [trace]);
  const visibleSteps = useMemo(
    () =>
      guided
        ? learningStepIndices(steps, breakpoints)
        : steps.map((_, index) => index),
    [steps, guided, breakpoints],
  );
  const position = Math.max(0, visibleSteps.indexOf(activeStep));
  const step = steps[activeStep] ?? null;
  const revealLine = useCallback((line) => {
    editorRef.current?.revealLineInCenter(line);
  }, []);

  useEffect(() => {
    let active = true;
    setLibrary((current) => ({ ...current, loading: true, error: "" }));
    api("/api/notebooks", { token })
      .then((notebooks) => {
        if (active)
          setLibrary({
            groups: savedVisualizerPrograms(notebooks),
            loading: false,
            error: "",
          });
      })
      .catch((error) => {
        if (!active) return;
        if (error.status === 401) {
          logout();
          return;
        }
        setLibrary((current) => ({
          ...current,
          loading: false,
          error:
            "Could not load saved notebooks. Try refreshing the file list.",
        }));
      });
    return () => {
      active = false;
    };
  }, [token, logout, libraryVersion]);

  useEffect(() => {
    const refresh = () => setLibraryVersion((current) => current + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const savedPrograms = useMemo(
    () => library.groups.flatMap((group) => group.programs),
    [library.groups],
  );
  const selectedExample = EXAMPLES.find((example) => example.source === source);
  const selectedProgram =
    openedFile?.key ||
    (selectedExample ? `example:${selectedExample.name}` : "");

  function openProgram(value) {
    const saved = savedPrograms.find((program) => program.key === value);
    if (saved) {
      setOpenedFile(saved);
      setCode(saved.source);
      return;
    }
    const example = EXAMPLES.find((item) => `example:${item.name}` === value);
    if (example) {
      setOpenedFile(null);
      setCode(example.source);
    }
  }

  useEffect(() => {
    if (!visibleSteps.length) return;
    setActiveStep((current) =>
      visibleSteps.includes(current)
        ? current
        : (visibleSteps.find((index) => index >= current) ??
          visibleSteps.at(-1)),
    );
  }, [visibleSteps]);

  function disposeTraceWorker() {
    if (traceWorkerRef.current) {
      traceWorkerRef.current.terminate();
      traceWorkerRef.current = null;
    }
    if (traceTimeoutRef.current) {
      window.clearTimeout(traceTimeoutRef.current);
      traceTimeoutRef.current = null;
    }
  }

  function cancelTrace() {
    disposeTraceWorker();
    setTracing(false);
    setTraceError("Visualization cancelled.");
  }

  function runTrace() {
    disposeTraceWorker();
    setTracing(false);
    setPlaying(false);
    setTraceError("");
    setTrace(null);
    setActiveStep(0);
    if (!source.trim()) {
      setTrace(null);
      setTraceError(
        "Add some JavaScript code or load the example to get started.",
      );
      return;
    }
    try {
      const worker = new Worker(
        new URL("../lib/visualizer.worker.js", import.meta.url),
        { type: "module" },
      );
      traceWorkerRef.current = worker;
      setTracing(true);
      worker.onmessage = (event) => {
        if (traceWorkerRef.current !== worker) return;
        disposeTraceWorker();
        setTracing(false);
        if (event.data?.type === "result") {
          setTrace(event.data.result);
          setActiveStep(
            guided
              ? (learningStepIndices(
                  event.data.result.events,
                  breakpoints,
                )[0] ?? 0)
              : 0,
          );
          setTraceError("");
        } else {
          setTraceError(event.data?.message || "Could not trace this program.");
        }
      };
      worker.onerror = (event) => {
        if (traceWorkerRef.current !== worker) return;
        disposeTraceWorker();
        setTracing(false);
        setTraceError(event.message || "The visualizer worker failed.");
      };
      traceTimeoutRef.current = window.setTimeout(() => {
        if (traceWorkerRef.current !== worker) return;
        disposeTraceWorker();
        setTracing(false);
        setTraceError(
          "Visualization exceeded the 6-second worker time limit and was stopped.",
        );
      }, TRACE_TIMEOUT_MS);
      worker.postMessage({ type: "trace", source });
    } catch (error) {
      disposeTraceWorker();
      setTraceError(error.message || "Could not start the visualizer worker.");
    }
  }

  function setCode(value) {
    disposeTraceWorker();
    setTracing(false);
    setSource(value ?? "");
    setActiveStep(0);
    setBreakpoints([]);
    setTrace(null);
    setTraceError("");
    setPlaying(false);
  }

  function advance() {
    setActiveStep(
      visibleSteps[Math.min(position + 1, visibleSteps.length - 1)] ?? 0,
    );
  }

  function runToBreakpoint() {
    setPlaying(false);
    if (!steps.length || !breakpoints.length) return;
    const next = steps.findIndex(
      (event, index) => index > activeStep && breakpoints.includes(event.line),
    );
    if (next < 0) {
      setPlaying(false);
      return;
    }
    setActiveStep(next);
  }

  useEffect(() => {
    if (!playing || !steps.length) return undefined;
    const timer = window.setInterval(
      () => {
        const next =
          visibleSteps[Math.min(position + 1, visibleSteps.length - 1)];
        setActiveStep(next);
        if (
          next === visibleSteps.at(-1) ||
          breakpoints.includes(steps[next]?.line)
        )
          setPlaying(false);
      },
      (guided ? 1700 : 850) / speed,
    );
    return () => window.clearInterval(timer);
  }, [
    playing,
    speed,
    steps,
    breakpoints,
    activeStep,
    guided,
    visibleSteps,
    position,
  ]);

  useEffect(() => {
    let cancelled = false;
    loader.config({
      paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" },
    });
    loader
      .init()
      .then((monaco) => {
        if (cancelled) return;
        defineVisualizerTheme(monaco);
        monaco.editor.setTheme("visualizer");
        monacoRef.current = monaco;
        setEditorReady(true);
      })
      .catch(() => {
        if (!cancelled) setEditorFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      sessionStorage.removeItem(SOURCE_KEY);
    } catch {
      // The editor remains usable when browser storage is unavailable.
    }
    return () => disposeTraceWorker();
  }, []);

  function onEditorMount(editor, monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setEditorMounted(true);
    defineVisualizerTheme(monaco);
    monaco.editor.setTheme("visualizer");
    editor.onMouseDown((event) => {
      if (
        event.target.type !==
          monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        !event.target.position
      )
        return;
      const line = event.target.position.lineNumber;
      setBreakpoints((current) =>
        current.includes(line)
          ? current.filter((value) => value !== line)
          : [...current, line].sort((a, b) => a - b),
      );
    });
  }

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const decorations = breakpoints.map((line) => ({
      range: new monacoRef.current.Range(line, 1, line, 1),
      options: { glyphMarginClassName: "visualizer-breakpoint-glyph" },
    }));
    if (step) {
      decorations.push({
        range: new monacoRef.current.Range(step.line, 1, step.line, 1),
        options: {
          isWholeLine: true,
          className: "visualizer-active-line",
          glyphMarginClassName: "visualizer-active-glyph",
        },
      });
    }
    decorationsRef.current = editorRef.current.deltaDecorations(
      decorationsRef.current,
      decorations,
    );
    if (step) editorRef.current.revealLineInCenterIfOutsideViewport(step.line);
  }, [breakpoints, step, editorMounted]);

  const atEnd = visibleSteps.length > 0 && position === visibleSteps.length - 1;
  const status = tracing
    ? "Preparing trace"
    : traceError || trace?.error
      ? "Needs attention"
      : atEnd
        ? "Execution complete"
        : playing
          ? "Playing"
          : steps.length
            ? "Paused"
            : "Ready to explore";
  function jumpTo(index) {
    setPlaying(false);
    setActiveStep(index);
  }

  return (
    <main className={`vm-page ${focused ? "vm-focused" : ""}`}>
      <header className="vm-header">
        <div className="vm-brand">
          <a href="/" className="vm-home-brand" aria-label="Back to MyIDE">
            <span className="vm-back-arrow">
              <Icon name="arrow" />
            </span>
            <Brand />
          </a>
          <h1 aria-label="JavaScript Code Visualizer">
            <VisualizerBrand />
          </h1>
        </div>
        <div className="vm-header-actions">
          <details className="vm-help">
            <summary>How it works</summary>
            <div>
              <strong>Follow the story of your code.</strong>
              <p>
                The left side highlights the current line. Each executed step
                adds a card below the last on the right, with its actual values,
                calculations, and decisions.
              </p>
              <p>
                Earlier steps keep their original values. Before-and-after
                diagrams show array changes and shifts. Scroll up to review;
                Jump to latest resumes following. Click a card's line number to
                find its code. Previous Step rewinds the story.
              </p>
              <p>
                JavaScript built-ins, functions, classes, and async code run
                locally. Browser DOM, network APIs, Node.js, and external
                packages are separate environments.
              </p>
            </div>
          </details>
          <button
            type="button"
            className="vm-button vm-focus-button"
            onClick={() => setFocused(!focused)}
            aria-pressed={focused}
          >
            <Icon name="expand" />
            {focused ? "Exit focus" : "Focus"}
          </button>
        </div>
      </header>

      <div className="vm-toolbar" aria-label="Visualizer controls">
        <div className="vm-program-controls">
          <span className="vm-language">
            <b>JS</b>JavaScript
          </span>
          <span className="vm-toolbar-divider">/</span>
          <select
            aria-label="Open saved code or an example"
            title={
              openedFile
                ? `${openedFile.notebookName} / ${openedFile.fileName}`
                : "Open code from your notebooks or choose an example"
            }
            value={selectedProgram}
            onChange={(event) => openProgram(event.target.value)}
          >
            <option value="" disabled>
              Your code
            </option>
            {openedFile &&
              !savedPrograms.some(
                (program) => program.key === openedFile.key,
              ) && (
                <option value={openedFile.key}>
                  {openedFile.notebookName} / {openedFile.fileName} (loaded
                  copy)
                </option>
              )}
            {library.loading && (
              <option disabled>Loading saved notebooks…</option>
            )}
            {!library.loading && !library.error && !library.groups.length && (
              <option disabled>No saved notebooks yet</option>
            )}
            {library.error && (
              <option disabled>
                Saved notebooks unavailable — refresh to retry
              </option>
            )}
            {library.groups.map((group) => (
              <optgroup key={group.id} label={group.name}>
                {group.programs.length ? (
                  group.programs.map((program) => (
                    <option key={program.key} value={program.key}>
                      {program.fileName}
                    </option>
                  ))
                ) : (
                  <option disabled>No JavaScript files</option>
                )}
              </optgroup>
            ))}
            <optgroup label="Examples">
              {EXAMPLES.map((example) => (
                <option key={example.name} value={`example:${example.name}`}>
                  {example.name}
                </option>
              ))}
            </optgroup>
          </select>
          <button
            type="button"
            className="vm-button vm-library-refresh"
            title="Refresh saved file list"
            aria-label="Refresh saved file list"
            disabled={library.loading}
            onClick={() => setLibraryVersion((current) => current + 1)}
          >
            <Icon name="restart" size={15} />
          </button>
        </div>
        <div className="vm-playback-controls">
          <button
            type="button"
            className="vm-button"
            disabled={!steps.length || position === 0}
            onClick={() => jumpTo(visibleSteps[Math.max(0, position - 1)] ?? 0)}
            aria-label="Previous step"
          >
            <Icon name="back" size={16} />
            <span>Prev Step</span>
          </button>
          <div className="vm-player">
            <button
              type="button"
              className="vm-play-button"
              disabled={!steps.length}
              onClick={() => {
                if (atEnd) setActiveStep(visibleSteps[0] ?? 0);
                setPlaying((value) => !value);
              }}
              aria-label={
                playing
                  ? "Pause playback"
                  : atEnd
                    ? "Replay execution"
                    : "Play execution"
              }
            >
              <Icon name={playing ? "pause" : "play"} size={19} />
            </button>
            <div className="vm-progress">
              <span>
                {steps.length
                  ? `Step ${position + 1} of ${visibleSteps.length}`
                  : "Ready to visualize"}
              </span>
              <input
                aria-label="Jump to execution step"
                type="range"
                disabled={!steps.length}
                min="0"
                max={Math.max(1, visibleSteps.length - 1)}
                value={position}
                onChange={(event) =>
                  jumpTo(
                    visibleSteps[
                      Math.min(
                        Number(event.target.value),
                        visibleSteps.length - 1,
                      )
                    ] ?? 0,
                  )
                }
                style={{
                  "--vm-progress": `${visibleSteps.length > 1 ? (position / (visibleSteps.length - 1)) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <select
            className="vm-speed"
            aria-label="Playback speed"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}x
              </option>
            ))}
          </select>
          <button
            type="button"
            className="vm-button"
            disabled={!steps.length || atEnd}
            onClick={() => {
              setPlaying(false);
              advance();
            }}
            aria-label="Next step"
          >
            <span>Next Step</span>
            <Icon name="next" size={16} />
          </button>
          <button
            type="button"
            className="vm-button vm-restart"
            disabled={!steps.length || position === 0}
            onClick={() => jumpTo(visibleSteps[0] ?? 0)}
            aria-label="Restart playback"
            title="Restart"
          >
            <Icon name="restart" size={16} />
          </button>
        </div>
        <div className="vm-run-controls">
          <select
            aria-label="Execution detail"
            value={guided ? "key" : "all"}
            onChange={(event) => {
              setPlaying(false);
              setGuided(event.target.value === "key");
            }}
          >
            <option value="key">Key steps</option>
            <option value="all">Every event</option>
          </select>
          <button
            type="button"
            className={`vm-button vm-run ${tracing ? "vm-cancel" : ""}`}
            onClick={tracing ? cancelTrace : runTrace}
          >
            <Icon name={tracing ? "pause" : "play"} size={15} />
            {tracing ? "Cancel" : trace ? "Run again" : "Visualize"}
          </button>
        </div>
      </div>

      <div className="vm-workspace">
        <section className="vm-code" aria-label="JavaScript source code">
          <div className="vm-filebar">
            <span>
              <i />
              <span
                className="vm-file-name"
                title={
                  openedFile
                    ? `${openedFile.notebookName} / ${openedFile.fileName}`
                    : "main.js"
                }
              >
                {openedFile
                  ? `${openedFile.notebookName} / ${openedFile.fileName}`
                  : "main.js"}
              </span>
            </span>
            <span
              title={
                openedFile
                  ? "Edits here are for visualization. Your saved file stays unchanged."
                  : undefined
              }
            >
              {openedFile
                ? source === openedFile.source
                  ? "Editable copy"
                  : "Edited copy"
                : "Editable"}
            </span>
          </div>
          {library.error && (
            <div className="vm-library-notice" role="alert">
              <span>{library.error}</span>
              <button
                type="button"
                disabled={library.loading}
                onClick={() => setLibraryVersion((current) => current + 1)}
              >
                {library.loading ? "Loading…" : "Retry"}
              </button>
            </div>
          )}
          <div className="vm-editor">
            {editorFailed ? (
              <textarea
                aria-label="JavaScript code"
                value={source}
                onChange={(event) => setCode(event.target.value)}
                spellCheck="false"
              />
            ) : (
              <Editor
                height="100%"
                language="javascript"
                theme="visualizer"
                value={source}
                onChange={setCode}
                onMount={onEditorMount}
                loading={
                  <div className="vm-editor-loading">Loading editor…</div>
                }
                options={{
                  automaticLayout: true,
                  fontFamily: 'Consolas, "Courier New", monospace',
                  fontSize: 14,
                  lineHeight: 24,
                  minimap: { enabled: false },
                  glyphMargin: true,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  wordWrap: "off",
                  readOnly: !editorReady,
                  padding: { top: 10, bottom: 12 },
                  bracketPairColorization: { enabled: false },
                  guides: { indentation: false },
                  renderLineHighlight: "none",
                  overviewRulerLanes: 0,
                  hideCursorInOverviewRuler: true,
                }}
              />
            )}
          </div>
          <footer className="vm-code-status">
            <span>{source.split("\n").length} lines</span>
            <span>
              {breakpoints.length
                ? `${breakpoints.length} breakpoint${breakpoints.length === 1 ? "" : "s"}`
                : "Click the gutter to set a breakpoint"}
            </span>
            {breakpoints.length > 0 && (
              <button
                type="button"
                disabled={
                  !steps.some(
                    (event, index) =>
                      index > activeStep && breakpoints.includes(event.line),
                  )
                }
                onClick={runToBreakpoint}
              >
                Next breakpoint →
              </button>
            )}
          </footer>
        </section>
        <section
          className="vm-visualization"
          aria-label="Visual execution history"
        >
          <ExecutionHistory
            trace={trace}
            activeStep={activeStep}
            source={source}
            indices={visibleSteps}
            onRevealLine={revealLine}
          />
          {(traceError || tracing) && (
            <div
              className={`vm-caption ${traceError ? "vm-caption-error" : ""}`}
              role={traceError ? "alert" : "status"}
            >
              <span>
                {tracing ? "TRACING" : step ? `LINE ${step.line}` : "NOTICE"}
              </span>
              <p title={traceError}>
                {tracing
                  ? "Preparing the execution. Each step will be added to the history."
                  : traceError}
              </p>
              <small>{status}</small>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
