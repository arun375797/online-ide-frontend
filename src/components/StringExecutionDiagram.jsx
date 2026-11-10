import { useEffect, useState } from "react";

const COLUMNS = 24;
const PAGE_SIZE = 48;
const CELL = 30;
const character = (value) =>
  value === " " ? "␠" : value === "\n" ? "↵" : value === "\t" ? "⇥" : value;
const characterName = (value) =>
  value === " "
    ? "space"
    : value === undefined
      ? "outside the string"
      : JSON.stringify(value);

function difference(before, after, removedIndex) {
  if (removedIndex !== undefined)
    return {
      start: removedIndex,
      oldEnd: removedIndex + 1,
      newEnd: removedIndex,
    };
  let start = 0;
  while (
    start < Math.min(before.length, after.length) &&
    before[start] === after[start]
  )
    start++;
  let suffix = 0;
  while (
    suffix < Math.min(before.length, after.length) - start &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  )
    suffix++;
  return {
    start,
    oldEnd: before.length - suffix,
    newEnd: after.length - suffix,
  };
}

export default function StringExecutionDiagram({ lesson, activeStep }) {
  const state = lesson.string;
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(Math.floor(Math.max(0, state.index) / PAGE_SIZE));
  }, [activeStep, state.name, state.index]);
  const length = Math.max(state.before.length, state.after.length);
  const pages = Math.max(1, Math.ceil(length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const start = currentPage * PAGE_SIZE;
  const count = Math.min(PAGE_SIZE, Math.max(1, length - start));
  const columns = Math.min(COLUMNS, count);
  const rows = Math.ceil(count / COLUMNS);
  const width = Math.max(470, columns * CELL + 88);
  const bandHeight = rows * 57 + 33;
  const pointerMoved =
    state.beforeIndex >= 0 &&
    state.index >= 0 &&
    state.beforeIndex !== state.index;
  const compare = state.changed || pointerMoved;
  const height = compare ? bandHeight * 2 + 68 : bandHeight + 75;
  const diff = difference(state.before, state.after, state.removedIndex);

  function band(value, y, label, before = false) {
    const index = before ? state.beforeIndex : state.index;
    return (
      <g transform={`translate(0, ${y})`}>
        <text x="16" y="19" className="viz-string-label">
          {label}
          <tspan className="viz-string-length">
            {" "}
            · {value.length} characters
          </tspan>
        </text>
        {state.pointerName && (
          <text
            x={width - 16}
            y="19"
            textAnchor="end"
            className="viz-string-pointer-label"
          >
            {state.pointerName} = {index} · {characterName(value[index])}
          </text>
        )}
        {Array.from({ length: count }, (_, slot) => {
          const position = start + slot;
          if (position >= value.length) return null;
          const x = 44 + (slot % COLUMNS) * CELL;
          const cellY = 33 + Math.floor(slot / COLUMNS) * 57;
          const removed =
            state.changed &&
            before &&
            position >= diff.start &&
            position < diff.oldEnd;
          const added =
            state.changed &&
            !before &&
            position >= diff.start &&
            position < diff.newEnd;
          const focused = position === index;
          return (
            <g
              key={position}
              transform={`translate(${x}, ${cellY})`}
              className={`viz-string-cell ${removed ? "is-removed" : added ? "is-added" : ""} ${focused ? "is-focused" : ""}`}
            >
              <title>{`${state.name}[${position}] is ${characterName(value[position])}${removed ? "; removed from the new value" : ""}`}</title>
              <rect width="27" height="30" rx="4" />
              <text x="13.5" y="21" textAnchor="middle">
                {character(value[position])}
              </text>
              <text
                x="13.5"
                y="44"
                textAnchor="middle"
                className="viz-string-index"
              >
                {position}
              </text>
              {focused && (
                <path d="M9 -7h9l-4.5 5Z" className="viz-string-pointer" />
              )}
            </g>
          );
        })}
        {!value.length && (
          <text x="44" y="58" className="viz-string-length">
            Empty string
          </text>
        )}
      </g>
    );
  }

  return (
    <div className="viz-string-diagram">
      <div className="viz-string-heading">
        <strong>
          <code>{state.name}</code>
          <span>STRING</span>
        </strong>
        <div>
          <span>
            <i className="is-pointer" />
            Current index
          </span>
          {state.changed && (
            <>
              <span>
                <i className="is-removed" />
                Removed
              </span>
              <span>
                <i className="is-added" />
                Added
              </span>
            </>
          )}
          <span>␠ = space</span>
        </div>
      </div>
      <svg
        className="viz-string-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${state.name}: ${state.changed ? `changes from ${JSON.stringify(state.before)} to ${JSON.stringify(state.after)}` : JSON.stringify(state.after)}.${state.pointerName ? ` ${state.pointerName} is ${state.index}.` : ""}`}
      >
        {compare ? (
          <>
            {band(state.before, 10, "Before this line", true)}
            <path
              d={`M${width / 2} ${bandHeight + 12}v20m-6-6 6 6 6-6`}
              className="viz-string-flow"
            />
            {band(state.after, bandHeight + 40, "After this line")}
          </>
        ) : (
          band(state.after, 20, "Current value")
        )}
        <text
          x={width / 2}
          y={height - 8}
          textAnchor="middle"
          className="viz-string-summary"
        >
          {state.changed
            ? `${state.before.length} → ${state.after.length} characters · the new string is stored in ${state.name}`
            : pointerMoved
              ? `${state.pointerName} moves from ${state.beforeIndex} to ${state.index}. The string stays the same.`
              : state.index >= state.after.length && state.index >= 0
                ? "This index is past the last character. The loop check decides what happens next."
                : "Each box is one character. The number below it is its index, starting at 0."}
        </text>
      </svg>
      <div className="viz-diagram-navigation">
        <span>
          {state.changed
            ? state.removedIndex !== undefined
              ? `Removed the space at index ${state.removedIndex}. Following characters have lower indexes in the new string.`
              : "Compare the old and new characters above."
            : state.pointerName && state.index >= 0
              ? `${state.name}[${state.pointerName}] = ${characterName(state.after[state.index])}`
              : "Strings are values: an update stores a new string."}
        </span>
        {pages > 1 && (
          <div>
            <button
              type="button"
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
              aria-label="Previous characters"
            >
              ←
            </button>
            <span>
              Characters {start}–{Math.min(start + PAGE_SIZE, length) - 1}
            </span>
            <button
              type="button"
              disabled={currentPage === pages - 1}
              onClick={() => setPage(currentPage + 1)}
              aria-label="Next characters"
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
