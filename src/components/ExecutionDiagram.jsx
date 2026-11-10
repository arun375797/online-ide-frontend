import { useEffect, useId, useMemo, useRef, useState } from "react";
import CallStackDiagram from "./CallStackDiagram.jsx";
import StringExecutionDiagram from "./StringExecutionDiagram.jsx";
import {
  cellState,
  collectArrayShapes,
  focusedCell,
  samePath,
} from "../lib/executionDiagram.js";

const ROWS = 4;
const COLUMNS = 6;
const CELL = 56;

function format(value) {
  if (value === undefined) return "undefined";
  const text =
    typeof value === "string"
      ? JSON.stringify(value)
      : Array.isArray(value)
        ? `[${value.length} items]`
        : String(value);
  return text.length > 8 ? `${text.slice(0, 7)}…` : text;
}

export default function ExecutionDiagram({
  trace,
  step,
  previousVariables,
  activeStep,
  playing,
  lesson,
}) {
  const arrowId = useId().replace(/:/g, "");
  const canvasRef = useRef(null);
  const [wide, setWide] = useState(true);
  const shapes = useMemo(
    () => collectArrayShapes(trace?.events || []),
    [trace],
  );
  const hasShapes = shapes.length > 0;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const resize = () =>
      setWide(canvas.clientWidth / Math.max(1, canvas.clientHeight) > 1.9);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [hasShapes]);
  const [page, setPage] = useState(0);
  const [rowPage, setRowPage] = useState(0);
  const [columnPage, setColumnPage] = useState(0);
  const focus = focusedCell(step, shapes);
  const pages = Math.max(1, Math.ceil(shapes.length / 3));
  const currentPage = Math.min(page, pages - 1);
  const visible = shapes.slice(currentPage * 3, currentPage * 3 + 3);
  const rowPages = Math.max(
    1,
    ...visible.map((shape) => Math.ceil(shape.rows / ROWS)),
  );
  const columnPages = Math.max(
    1,
    ...visible.map((shape) => Math.ceil(shape.columns / COLUMNS)),
  );
  const rowStart = Math.min(rowPage, rowPages - 1) * ROWS;
  const columnStart = Math.min(columnPage, columnPages - 1) * COLUMNS;

  useEffect(() => {
    const index = shapes.findIndex((shape) => shape.name === focus.name);
    if (index >= 0) setPage(Math.floor(index / 3));
    setRowPage(Math.floor(Math.max(0, focus.row) / ROWS));
    setColumnPage(Math.floor(Math.max(0, focus.column) / COLUMNS));
  }, [activeStep, trace, focus.name, focus.row, focus.column, shapes]);

  const nodes = visible.map((shape) => {
    const rows = shape.matrix
      ? Math.min(ROWS, Math.max(1, shape.rows - rowStart))
      : 1;
    const columns = Math.min(COLUMNS, Math.max(1, shape.columns - columnStart));
    return {
      ...shape,
      shownRows: rows,
      shownColumns: columns,
      width: columns * CELL + 66,
      height: rows * CELL + 68,
    };
  });
  const horizontal = nodes.length === 3 && wide;
  const width = horizontal
    ? Math.max(640, nodes.reduce((sum, node) => sum + node.width, 0) + 160)
    : nodes.length > 1
      ? Math.max(
          640,
          nodes[0].width + nodes[1].width + 96,
          (nodes[2]?.width || 0) + 80,
        )
      : Math.max(560, (nodes[0]?.width || 0) + 96);
  const topHeight = Math.max(
    ...nodes.slice(0, horizontal ? 3 : 2).map((node) => node.height),
    160,
  );
  const height =
    nodes.length === 3 && !horizontal
      ? topHeight + nodes[2].height + 130
      : topHeight + 130;
  nodes.forEach((node, index) => {
    node.x = horizontal
      ? 22 +
        nodes.slice(0, index).reduce((sum, item) => sum + item.width + 58, 0)
      : nodes.length === 1 || index === 2
        ? (width - node.width) / 2
        : index === 0
          ? 22
          : width - node.width - 22;
    node.y = index === 2 && !horizontal ? topHeight + 92 : 24;
  });

  function anchor(name, path) {
    const node = nodes.find((item) => item.name === name);
    if (
      !node ||
      !path?.length ||
      path.some((key) => !Number.isInteger(Number(key)))
    )
      return null;
    const row = node.matrix ? Number(path[0]) - rowStart : 0;
    const column = Number(path[node.matrix ? 1 : 0] ?? 0) - columnStart;
    if (
      row < 0 ||
      row >= node.shownRows ||
      column < 0 ||
      column >= node.shownColumns
    )
      return null;
    return {
      x: node.x + 48 + column * CELL + 24,
      y: node.y + 46 + row * CELL + 24,
      node,
    };
  }

  const destination = step?.write && anchor(step.write.name, step.write.path);
  const sources = (step?.reads || [])
    .filter(
      (read) =>
        read.path.length ===
        (shapes.find((shape) => shape.name === read.name)?.matrix ? 2 : 1),
    )
    .map((read) => ({ ...read, point: anchor(read.name, read.path) }))
    .filter((read) => read.point);
  const calculation = step?.calculation;
  const formula = calculation
    ? `${format(calculation.left)} ${calculation.operator} ${format(calculation.right)} = ${format(calculation.value)}`
    : step?.write
      ? `${step.write.name}${step.write.path.map((index) => `[${index}]`).join("")} ← ${format(step.write.value)}`
      : step?.condition
        ? `${step.condition} → ${step.result ? "true" : "false"}`
        : lesson?.substitution ||
          lesson?.title ||
          "Follow the highlighted line to see each change";

  if (
    !shapes.length &&
    lesson?.string &&
    !["call", "return", "error"].includes(lesson.kind)
  )
    return <StringExecutionDiagram lesson={lesson} activeStep={activeStep} />;

  if (!shapes.length && step)
    return (
      <CallStackDiagram
        step={step}
        previousStep={trace?.events?.[activeStep - 1]}
        activeStep={activeStep}
        lesson={lesson}
      />
    );
  if (!shapes.length)
    return (
      <div className="viz-diagram-empty">
        <svg viewBox="0 0 200 90" aria-hidden="true">
          <path d="M20 45h45m70 0h45" stroke="#8091ba" strokeDasharray="4 4" />
          <rect
            x="68"
            y="20"
            width="64"
            height="50"
            rx="6"
            fill="#2d3c54"
            stroke="#829bcd"
          />
          <text
            x="100"
            y="53"
            textAnchor="middle"
            fill="#c5d6f5"
            fontSize="24"
          >{`{ }`}</text>
        </svg>
        <h3>
          {trace
            ? "Following your variables"
            : "See the execution, not just the output"}
        </h3>
        <p>
          {trace
            ? "Values and calculations update as you step through your code."
            : "Choose Matrix addition, then Visualize code. Watch values flow from source cells into the result."}
        </p>
        {calculation && (
          <code className="viz-empty-calculation">{formula}</code>
        )}
      </div>
    );

  return (
    <div className={`viz-execution-diagram ${playing ? "is-playing" : ""}`}>
      <div className="viz-diagram-legend">
        <span>
          <i className="is-read" />
          Reading
        </span>
        <span>
          <i className="is-written" />
          Writing
        </span>
        <span>
          <i className="is-cursor" />
          Loop position
        </span>
        <span className="viz-diagram-hint">
          Dashed cells are not created yet
        </span>
      </div>
      <svg
        ref={canvasRef}
        className="viz-diagram-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Execution diagram. ${formula}`}
      >
        <defs>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10Z" fill="#8db8f0" />
          </marker>
        </defs>
        {nodes.map((node) => (
          <g
            key={node.name}
            transform={`translate(${node.x}, ${node.y})`}
            className="viz-matrix-node"
          >
            <rect
              width={node.width}
              height={node.height}
              rx="8"
              className="viz-matrix-frame"
            />
            <text x="14" y="23" className="viz-matrix-name">
              {node.name}
            </text>
            <text
              x={node.width - 12}
              y="23"
              textAnchor="end"
              className="viz-matrix-dimensions"
            >
              {!step?.variables?.[node.name]
                ? "not declared yet"
                : node.matrix
                  ? `${step.variables[node.name].value.length} rows`
                  : `${step.variables[node.name].value.length} items`}
            </text>
            {Array.from({ length: node.shownColumns }, (_, column) => (
              <text
                key={column}
                x={72 + column * CELL}
                y="40"
                textAnchor="middle"
                className="viz-matrix-index"
              >
                {column + columnStart}
              </text>
            ))}
            {Array.from({ length: node.shownRows }, (_, row) => {
              const actualRow = node.matrix ? row + rowStart : 0;
              return (
                <g key={actualRow}>
                  {node.matrix && (
                    <text
                      x="28"
                      y={76 + row * CELL}
                      textAnchor="middle"
                      className="viz-matrix-index"
                    >
                      {actualRow}
                    </text>
                  )}
                  {Array.from({ length: node.shownColumns }, (_, column) => {
                    const actualColumn = column + columnStart;
                    const path = node.matrix
                      ? [actualRow, actualColumn]
                      : [actualColumn];
                    const state = cellState(
                      node.name,
                      path,
                      step,
                      previousVariables,
                    );
                    return (
                      <g
                        key={actualColumn}
                        transform={`translate(${48 + column * CELL}, ${46 + row * CELL})`}
                        className={`viz-matrix-cell ${state.written ? "is-written" : state.read ? "is-read" : state.changed ? "is-changed" : ""} ${state.exists ? "" : "is-pending"}`}
                      >
                        <title>{`${node.name}${path.map((index) => `[${index}]`).join("")} = ${state.exists ? JSON.stringify(state.value) : "not created"}${state.changed ? `; previously ${JSON.stringify(state.previous)}` : ""}`}</title>
                        <rect width="48" height="48" rx="4" />
                        <text
                          x="24"
                          y="29"
                          textAnchor="middle"
                          key={`${activeStep}-${String(state.value)}`}
                        >
                          {state.exists ? format(state.value) : "·"}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {focus.row >= (node.matrix ? rowStart : 0) &&
              focus.row < (node.matrix ? rowStart + node.shownRows : 1) &&
              focus.column >= columnStart &&
              focus.column < columnStart + node.shownColumns && (
                <rect
                  className="viz-matrix-cursor"
                  width="52"
                  height="52"
                  rx="5"
                  x={46 + (focus.column - columnStart) * CELL}
                  y={44 + (node.matrix ? focus.row - rowStart : 0) * CELL}
                />
              )}
          </g>
        ))}
        {destination &&
          sources
            .filter(
              (read) =>
                read.name !== step.write.name ||
                !samePath(read.path, step.write.path),
            )
            .map((read, index) => {
              const source = read.point;
              const edge =
                source.node.x < destination.node.x
                  ? source.node.x + source.node.width + 12
                  : source.node.x - 12;
              const destinationEdge =
                source.node.x < destination.node.x
                  ? destination.node.x - 12
                  : destination.node.x + destination.node.width + 12;
              const bridge =
                Math.max(
                  source.node.y + source.node.height,
                  horizontal ? destination.node.y + destination.node.height : 0,
                ) +
                20 +
                index * 12;
              const landingX =
                destination.x + (source.node.x < destination.node.x ? -16 : 16);
              const path = `M${source.x} ${source.y + 27} H${edge} V${bridge} H${destinationEdge} V${destination.y - 27} H${landingX} V${destination.y - 25}`;
              return (
                <path
                  key={`${read.name}-${read.path.join("-")}`}
                  className="viz-value-transfer"
                  d={path}
                  markerEnd={`url(#${arrowId})`}
                  style={{ animationDelay: `${index * 100}ms` }}
                />
              );
            })}
        <g
          className="viz-diagram-calculation"
          key={activeStep}
          transform={`translate(${width / 2}, ${nodes.length === 3 && !horizontal ? topHeight + 59 : height - 30})`}
        >
          <rect
            x={-Math.min(width - 48, Math.max(250, formula.length * 9)) / 2}
            y="-23"
            width={Math.min(width - 48, Math.max(250, formula.length * 9))}
            height="40"
            rx="7"
          />
          <text textAnchor="middle" y="3">
            {formula.length > 72 ? `${formula.slice(0, 69)}…` : formula}
          </text>
          <title>{formula}</title>
        </g>
      </svg>
      <div className="viz-diagram-navigation">
        <span>
          {step?.write
            ? `Write: ${step.write.name}${step.write.path.map((index) => `[${index}]`).join("")}`
            : sources.length
              ? `Read: ${sources.map((read) => `${read.name}${read.path.map((index) => `[${index}]`).join("")}`).join(", ")}`
              : "Step forward to follow the data"}
        </span>
        {pages > 1 && (
          <div>
            <button
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
              aria-label="Previous data structures"
            >
              ←
            </button>
            <span>
              Structures {currentPage + 1}/{pages}
            </span>
            <button
              disabled={currentPage === pages - 1}
              onClick={() => setPage(currentPage + 1)}
              aria-label="Next data structures"
            >
              →
            </button>
          </div>
        )}
        {rowPages > 1 && (
          <div>
            <button
              disabled={!rowStart}
              onClick={() => setRowPage(Math.max(0, rowPage - 1))}
              aria-label="Previous matrix rows"
            >
              ↑
            </button>
            <span>
              Rows {rowStart}–
              {Math.min(
                rowStart + ROWS,
                Math.max(...visible.map((node) => node.rows)),
              ) - 1}
            </span>
            <button
              disabled={rowStart / ROWS >= rowPages - 1}
              onClick={() => setRowPage(Math.min(rowPage, rowPages - 1) + 1)}
              aria-label="Next matrix rows"
            >
              ↓
            </button>
          </div>
        )}
        {columnPages > 1 && (
          <div>
            <button
              disabled={!columnStart}
              onClick={() => setColumnPage(Math.max(0, columnPage - 1))}
              aria-label="Previous matrix columns"
            >
              ←
            </button>
            <span>
              Columns {columnStart}–
              {Math.min(
                columnStart + COLUMNS,
                Math.max(...visible.map((node) => node.columns)),
              ) - 1}
            </span>
            <button
              disabled={columnStart / COLUMNS >= columnPages - 1}
              onClick={() =>
                setColumnPage(Math.min(columnPage, columnPages - 1) + 1)
              }
              aria-label="Next matrix columns"
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
