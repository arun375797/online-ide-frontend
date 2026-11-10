import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildMemoryGraph,
  memoryValue,
  prepareMemorySource,
} from "../lib/memoryGraph.js";

function CellValue({ value, type, reference, previous, changed }) {
  const [expanded, setExpanded] = useState(false);
  if (reference)
    return (
      <span
        className="vm-reference-dot"
        aria-label="Reference to a data structure"
      >
        •
      </span>
    );
  const full = memoryValue(value, type);
  return (
    <span
      className={`vm-value vm-value-${type || typeof value}`}
      title={
        changed && previous !== undefined
          ? `Previously ${memoryValue(previous)}`
          : full
      }
    >
      {full.length > 180 && !expanded ? (
        <>
          {full.slice(0, 176)}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Show full value"
          >
            …
          </button>
        </>
      ) : (
        full
      )}
    </span>
  );
}

function VariablesTable({ rows, previous, caption = "Variables" }) {
  return (
    <div className="vm-variables">
      {caption && <span className="vm-table-tag">{caption}</span>}
      <table>
        <tbody>
          {rows.map((row) => {
            const old = previous?.[row.name];
            const changed =
              !old ||
              (row.reference
                ? old.reference !== row.reference
                : JSON.stringify(old.value) !== JSON.stringify(row.value));
            return (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td
                  className={changed ? "vm-changed" : ""}
                  data-memory-reference={row.reference || undefined}
                  data-memory-source={row.sourceId}
                >
                  <CellValue {...row} previous={old?.value} changed={changed} />
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan="2" className="vm-empty-cell">
                No values declared yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function HeapTable({ node, graph, previous, step }) {
  const value = node.value;
  const matrix =
    node.kind === "array" && value.length > 0 && value.every(Array.isArray);
  const dataCell = (item, path, reference) => {
    const old = path.reduce((parent, key) => parent?.[key], previous?.value);
    const changed = !previous || JSON.stringify(old) !== JSON.stringify(item);
    const read = step?.reads?.some(
      (read) =>
        read.name &&
        node.names.includes(read.name) &&
        read.path.length === path.length &&
        read.path.every((key, index) => String(key) === String(path[index])),
    );
    return (
      <td
        key={path.join(":")}
        className={`${changed ? "vm-changed" : ""} ${read ? "vm-read" : ""}`}
        data-memory-reference={reference || undefined}
        data-memory-source={`heap:${node.id}:${path.join(":")}`}
      >
        <CellValue
          value={item}
          reference={reference}
          previous={old}
          changed={changed}
        />
      </td>
    );
  };
  let table;
  if (matrix) {
    const columns = Math.max(0, ...value.map((row) => row.length));
    table = (
      <table className="vm-array-table">
        <thead>
          <tr>
            <th aria-label="Row and column index" />
            {Array.from({ length: columns }, (_, index) => (
              <th key={index} scope="col">
                {index}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {value.map((row, index) => {
            const rowReference = node.links?.find(
              (link) => String(link.key) === String(index),
            )?.reference;
            const rowObject = graph.objects.get(rowReference);
            return (
              <tr key={index} data-memory-target={rowReference || undefined}>
                <th scope="row">{index}</th>
                {columns ? (
                  Array.from({ length: columns }, (_, column) =>
                    Object.hasOwn(row, column) ? (
                      dataCell(
                        row[column],
                        [index, column],
                        rowObject?.links.find(
                          (link) => String(link.key) === String(column),
                        )?.reference,
                      )
                    ) : (
                      <td
                        key={column}
                        className="vm-unwritten"
                        title="This cell has not been created"
                      >
                        ·
                      </td>
                    ),
                  )
                ) : (
                  <td className="vm-empty-cell">empty row</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  } else if (node.kind === "array") {
    const chunks = Array.from(
      { length: Math.ceil(value.length / 8) },
      (_, index) => value.slice(index * 8, index * 8 + 8),
    );
    table = chunks.length ? (
      <div className="vm-array-chunks">
        {chunks.map((chunk, chunkIndex) => (
          <table className="vm-array-table" key={chunkIndex}>
            <thead>
              <tr>
                {chunk.map((_, index) => (
                  <th key={index} scope="col">
                    {chunkIndex * 8 + index}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {chunk.map((item, index) =>
                  dataCell(
                    item,
                    [chunkIndex * 8 + index],
                    node.links?.find(
                      (link) =>
                        String(link.key) === String(chunkIndex * 8 + index),
                    )?.reference,
                  ),
                )}
              </tr>
            </tbody>
          </table>
        ))}
      </div>
    ) : (
      <table>
        <tbody>
          <tr>
            <td className="vm-empty-cell">
              [ ] <span>empty array</span>
            </td>
          </tr>
        </tbody>
      </table>
    );
  } else {
    let entries =
      value && typeof value === "object"
        ? Object.entries(value)
        : [["value", value]];
    if (node.kind === "Map") entries = value?.Map || entries;
    if (node.kind === "Set")
      entries = (value?.Set || []).map((item, index) => [index, item]);
    table = (
      <table className="vm-object-table">
        <tbody>
          {entries.map(([key, item]) => (
            <tr key={String(key)}>
              <th scope="row">{String(key)}</th>
              {dataCell(
                item,
                [key],
                node.links?.find((link) => String(link.key) === String(key))
                  ?.reference,
              )}
            </tr>
          ))}
          {!entries.length && (
            <tr>
              <td className="vm-empty-cell">
                {} <span>empty object</span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }
  return (
    <section
      className={`vm-heap-node ${node.live ? "" : "vm-unreferenced"}`}
      data-memory-object={node.id}
      data-memory-target={node.id}
      aria-label={`${node.kind} ${node.names.join(", ")}`}
    >
      <div className="vm-node-heading">
        <span className="vm-node-tag">{node.kind}</span>
        <span className="vm-node-aliases" title={node.names.join(", ")}>
          {node.names.join(" · ")}
        </span>
        {!node.live && (
          <span
            className="vm-reference-status"
            title="This structure has no reference visible in the current scopes"
          >
            no visible reference
          </span>
        )}
      </div>
      {table}
      {node.length > value?.length && (
        <p className="vm-snapshot-note">
          Showing {value.length} of {node.length} items
        </p>
      )}
    </section>
  );
}

export default function MemoryCanvas({ trace, activeStep, source, playing }) {
  const sourceLoops = useMemo(() => prepareMemorySource(source), [source]);
  const graph = useMemo(
    () => buildMemoryGraph(trace?.events || [], activeStep, sourceLoops),
    [trace, activeStep, sourceLoops],
  );
  const step = trace?.events?.[activeStep];
  const previous = trace?.events?.[activeStep - 1];
  const output = trace?.output?.slice(0, step?.output || 0) || [];
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const graphRef = useRef(null);
  const outputRef = useRef(null);
  const [following, setFollowing] = useState(true);
  const followRef = useRef(true);
  followRef.current = following;
  const [geometry, setGeometry] = useState({ width: 1, height: 1, paths: [] });
  const arrowId = `memory-arrow-${useId().replace(/:/g, "")}`;

  useLayoutEffect(() => {
    const canvas = graphRef.current;
    if (!canvas) return undefined;
    let animation;
    const measure = () => {
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(() => {
        const origin = canvas.getBoundingClientRect();
        const targets = new Map();
        canvas.querySelectorAll("[data-memory-target]").forEach((element) => {
          if (!targets.has(element.dataset.memoryTarget))
            targets.set(element.dataset.memoryTarget, element);
        });
        const paths = [];
        canvas
          .querySelectorAll("[data-memory-reference]")
          .forEach((element) => {
            const target = targets.get(element.dataset.memoryReference);
            if (!target) return;
            const start = element.getBoundingClientRect();
            const end = target.getBoundingClientRect();
            const x1 = start.right - origin.left + 1;
            const y1 = start.top - origin.top + start.height / 2;
            const x2 = end.left - origin.left - 2;
            const y2 = end.top - origin.top + end.height / 2;
            const bend = Math.max(35, Math.abs(x2 - x1) * 0.45);
            paths.push({
              id: element.dataset.memorySource,
              d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
            });
          });
        // Measure the flowing tables, excluding this overlay's previous size.
        // Otherwise stepping backwards would keep the old, taller scroll area.
        const bounds = [
          ...canvas.querySelectorAll(".vm-scope-card, .vm-heap-node, table"),
        ].map((element) => element.getBoundingClientRect());
        const next = {
          width: Math.max(
            canvas.clientWidth,
            ...bounds.map((box) => box.right - origin.left),
          ),
          height: Math.max(
            canvas.clientHeight,
            ...bounds.map((box) => box.bottom - origin.top),
          ),
          paths,
        };
        setGeometry((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    canvas
      .querySelectorAll(".vm-scope-card, .vm-heap-node")
      .forEach((node) => observer.observe(node));
    return () => {
      cancelAnimationFrame(animation);
      observer.disconnect();
    };
  }, [graph]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const viewport = scrollRef.current;
    if (!content || !viewport) return undefined;
    let previousHeight = content.clientHeight;
    const observer = new ResizeObserver(() => {
      const height = content.clientHeight;
      if (followRef.current && height > previousHeight + 2)
        viewport.scrollTop = viewport.scrollHeight;
      previousHeight = height;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [trace]);

  useEffect(() => {
    if (outputRef.current)
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output.length]);
  useEffect(() => {
    setFollowing(true);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [trace]);

  return (
    <div className={`vm-memory ${playing ? "vm-is-playing" : ""}`}>
      <div className="vm-canvas-tools">
        <span>
          <i className="vm-reference-key" />
          reference <i className="vm-change-key" />
          changed value
        </span>
        <button
          type="button"
          aria-pressed={following}
          onClick={() => {
            setFollowing(!following);
            if (!following && scrollRef.current)
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }}
        >
          {following ? "Following growth" : "Follow growth"}
        </button>
      </div>
      <div
        className="vm-memory-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const area = event.currentTarget;
          if (area.scrollHeight > area.clientHeight + 20)
            setFollowing(
              area.scrollHeight - area.clientHeight - area.scrollTop < 50,
            );
        }}
      >
        <div className="vm-memory-content" ref={contentRef}>
          {output.length > 0 && (
            <section className="vm-output" aria-label="Output">
              <span className="vm-table-tag">Output</span>
              <pre ref={outputRef}>{output.join("\n")}</pre>
            </section>
          )}
          {!step ? (
            <div className="vm-canvas-empty">
              <div className="vm-empty-preview">
                <span>Variables</span>
                <b>→</b>
                <span>Data</span>
              </div>
              <h2>Watch your program take shape</h2>
              <p>
                Run the code, then play or step forward. Scopes appear on the
                left; arrays and objects build down the right.
              </p>
            </div>
          ) : (
            <div className="vm-reference-graph" ref={graphRef}>
              <div className="vm-scopes">
                {graph.scopes.map((scope) => {
                  const before =
                    previous?.callStack?.find((frame) => frame.id === scope.id)
                      ?.variables ||
                    (scope.id === 0 ? previous?.variables : {});
                  return (
                    <section
                      key={scope.id}
                      className={`vm-scope-card ${scope.active ? "vm-scope-active" : ""}`}
                      aria-label={scope.name}
                    >
                      <h3>
                        {scope.name}
                        <span>
                          {scope.returning
                            ? "returning"
                            : scope.active
                              ? ""
                              : "paused"}
                        </span>
                      </h3>
                      <VariablesTable rows={scope.rows} previous={before} />
                      {scope.loops.map((loop) => (
                        <section key={loop.id} className="vm-loop-card">
                          <div className="vm-loop-label">
                            <span>{loop.kind}</span>
                            <strong>iteration {loop.iteration || 1}</strong>
                            <small>line {loop.line}</small>
                          </div>
                          <VariablesTable
                            rows={loop.rows}
                            previous={before}
                            caption={null}
                          />
                        </section>
                      ))}
                    </section>
                  );
                })}
              </div>
              <div className="vm-heap">
                {graph.heap.map((node) => (
                  <HeapTable
                    key={node.id}
                    node={node}
                    graph={graph}
                    previous={{
                      value:
                        node.updatedAt === activeStep
                          ? node.previousValue
                          : node.value,
                    }}
                    step={step}
                  />
                ))}
              </div>
              <svg
                className="vm-reference-lines"
                width={geometry.width}
                height={geometry.height}
                viewBox={`0 0 ${geometry.width} ${geometry.height}`}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id={arrowId}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="8"
                    markerHeight="8"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 Z" />
                  </marker>
                </defs>
                {geometry.paths.map((path) => (
                  <path
                    key={path.id}
                    d={path.d}
                    markerEnd={`url(#${arrowId})`}
                  />
                ))}
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
