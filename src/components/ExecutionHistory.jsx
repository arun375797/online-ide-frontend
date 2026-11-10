import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildExecutionHistory,
  historyThrough,
} from "../lib/executionHistory.js";
import { lessonValue } from "../lib/executionLesson.js";
import "../executionHistory.css";

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const display = (value) => lessonValue(value, 100_000);

function visibleIndexes(length, focus = 0) {
  if (length <= 12) return Array.from({ length }, (_, i) => i);
  const start = Math.max(1, Math.min(length - 10, focus - 3));
  const end = Math.min(length - 1, start + 8);
  return [
    0,
    ...(start > 1 ? ["gap-start"] : []),
    ...Array.from({ length: end - start }, (_, i) => start + i),
    ...(end < length - 1 ? ["gap-end"] : []),
    length - 1,
  ];
}

/** Arrows connect surviving items to their new indexes; red items are removed. */
export function ArrayDiagram({
  before,
  after,
  pointer,
  pointerName,
  splice,
  string = false,
}) {
  const id = useId().replace(/:/g, "");
  const transition = Array.isArray(before) && !equal(before, after);
  const maxLength = Math.max(before?.length || 0, after.length);
  const indexes = visibleIndexes(maxLength, splice?.start ?? pointer ?? 0);
  const width = Math.max(260, 70 + indexes.length * 46);
  const cellX = (slot) => 70 + slot * 46;
  const removed = (index) =>
    splice && index >= splice.start && index < splice.start + splice.count;
  const row = (values, y, old) => (
    <g>
      <text x="0" y={y + 24} fill="#9daec4" fontSize="11">
        {transition ? (old ? "Before" : "After") : "Value"}
      </text>
      {indexes.map((index, slot) => {
        const x = cellX(slot);
        if (typeof index !== "number")
          return (
            <text
              key={index}
              x={x + 19}
              y={y + 25}
              textAnchor="middle"
              fill="#8292a9"
            >
              …
            </text>
          );
        if (index >= values.length) return null;
        const deleted = old && removed(index);
        const changed =
          transition && !old && !equal(values[index], before?.[index]);
        const selected = index === pointer && !old;
        let text =
          string && values[index] === " "
            ? "␠"
            : typeof values[index] === "string" && string
              ? values[index]
              : lessonValue(values[index], 5);
        return (
          <g key={index}>
            <title>{`Index ${index}: ${display(values[index])}${deleted ? " (removed)" : ""}`}</title>
            <text
              x={x + 20}
              y={y - 8}
              fill={selected ? "#74dbf5" : "#8b9bb2"}
              textAnchor="middle"
              fontSize="10"
            >
              {index}
            </text>
            <rect
              x={x}
              y={y}
              width="40"
              height="36"
              rx="5"
              fill={
                deleted
                  ? "#482b37"
                  : selected
                    ? "#173d50"
                    : changed
                      ? "#254439"
                      : "#262f40"
              }
              stroke={
                deleted
                  ? "#f38b9e"
                  : selected
                    ? "#50d1ef"
                    : changed
                      ? "#71cba2"
                      : "#465269"
              }
            />
            <text
              x={x + 20}
              y={y + 23}
              textAnchor="middle"
              fill={deleted ? "#ffadba" : "#f0f4fc"}
              fontSize="14"
            >
              {text}
            </text>
            {deleted && (
              <path
                d={`M${x + 8} ${y + 28}l24 -19`}
                stroke="#ff9bae"
                strokeWidth="2"
              />
            )}
            {!transition && selected && (
              <>
                <path d={`M${x + 20} ${y + 40}l-4 7h8Z`} fill="#65d7f1" />
                <text
                  x={x + 20}
                  y={y + 63}
                  fill="#86ddf2"
                  textAnchor="middle"
                  fontSize="11"
                >
                  {pointerName || "index"}
                </text>
              </>
            )}
          </g>
        );
      })}
      {!values.length && (
        <text x="73" y={y + 24} fill="#b4c1d5" fontSize="13">
          {string ? '"" (empty string)' : "[ ]  empty array"}
        </text>
      )}
    </g>
  );
  return (
    <div className="eh-array-visual">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={
          transition
            ? `Before: ${display(before)}. After: ${display(after)}.`
            : `${display(after)}${Number.isInteger(pointer) ? `. ${pointerName || "Index"} = ${pointer}` : ""}`
        }
        viewBox={`0 0 ${width} ${transition ? 190 : Number.isInteger(pointer) ? 103 : 78}`}
        style={{ width, maxWidth: "100%", minWidth: Math.min(width, 450) }}
        fontFamily="Consolas, monospace"
      >
        <defs>
          <marker
            id={`move-${id}`}
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path
              d="M0 0L6 3L0 6"
              fill="none"
              stroke="#6ed7d0"
              strokeWidth="1.2"
            />
          </marker>
        </defs>
        {row(transition ? before : after, 22, transition)}
        {transition && (
          <>
            {splice?.moves.map(({ from, to }) => {
              const fromSlot = indexes.indexOf(from),
                toSlot = indexes.indexOf(to);
              if (fromSlot < 0 || toSlot < 0) return null;
              const x1 = cellX(fromSlot) + 20,
                x2 = cellX(toSlot) + 20;
              return (
                <path
                  key={from}
                  d={`M${x1} 62C${x1} 94 ${x2} 100 ${x2} 119`}
                  fill="none"
                  stroke="#6ed7d0"
                  strokeOpacity=".7"
                  strokeWidth="1.3"
                  markerEnd={`url(#move-${id})`}
                />
              );
            })}
            {!splice?.moves.length && (
              <text x="72" y="94" fill="#81ccaf" fontSize="12">
                ↓ {string ? "new string" : "updated values"}
              </text>
            )}
            {splice?.count > 0 && (
              <text
                x={cellX(Math.max(0, indexes.indexOf(splice.start))) + 20}
                y="88"
                fill="#ff9bae"
                fontSize="10"
                textAnchor="middle"
              >
                removed
              </text>
            )}
            {row(after, 140, false)}
          </>
        )}
      </svg>
      {maxLength > 12 && (
        <small>
          Nearby indexes shown. Open “Recorded values” for the full snapshot.
        </small>
      )}
    </div>
  );
}

function Matrix({ view }) {
  const rows = view.after;
  return (
    <div className="eh-matrix-wrap">
      <table className="eh-matrix">
        <thead>
          <tr>
            <th>row / col</th>
            {Array.from(
              {
                length: Math.min(
                  10,
                  Math.max(...rows.map((row) => row.length), 0),
                ),
              },
              (_, col) => (
                <th key={col}>{col}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((row, r) => (
            <tr key={r}>
              <th>{r}</th>
              {row.slice(0, 10).map((value, c) => {
                const changed =
                  view.existed && !equal(view.before?.[r]?.[c], value);
                const existed =
                  view.before?.[r] && Object.hasOwn(view.before[r], c);
                return (
                  <td key={c} className={changed ? "eh-cell-changed" : ""}>
                    {changed && existed && (
                      <del>{lessonValue(view.before[r][c], 18)}</del>
                    )}
                    <span>{lessonValue(value, 32)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {(rows.length > 12 || rows.some((row) => row.length > 10)) && (
        <small>Open “Recorded values” for the full matrix.</small>
      )}
    </div>
  );
}

function ValueChanges({ changes }) {
  return (
    <div className="eh-value-changes">
      {changes.map((change) => (
        <div
          className="eh-value-change"
          key={`${change.frameId}-${change.name}`}
        >
          <code>{change.name}</code>
          {change.existed && (
            <>
              <span className="eh-old-value">{display(change.before)}</span>
              <span className="eh-arrow" aria-label="becomes">
                →
              </span>
            </>
          )}
          <strong className={change.exists ? "eh-new-value" : "eh-ended-value"}>
            {change.exists ? display(change.after) : "out of scope"}
          </strong>
          {!change.existed && <small>created</small>}
        </div>
      ))}
    </div>
  );
}

const HistoryCard = memo(function HistoryCard({ card, onRevealLine }) {
  const visualNames = new Set(card.arrays.map((view) => view.name));
  if (card.string) visualNames.add(card.string.name);
  const changes = card.changes.filter(
    (change) => !visualNames.has(change.name),
  );
  return (
    <li
      className={`eh-entry eh-kind-${card.kind}`}
      data-history-step={card.index}
    >
      <span className="eh-step-number" aria-label={`Step ${card.number}`}>
        {card.number}
      </span>
      <article className="eh-card">
        <div className="eh-card-heading">
          <h3>{card.title}</h3>
          <button
            type="button"
            className="eh-line"
            title="Show this line in the editor"
            onClick={() => onRevealLine?.(card.line)}
          >
            Line {card.line}
          </button>
        </div>
        {(card.scope !== "Global" || card.iteration) && (
          <div className="eh-context">
            {card.scope !== "Global" && <span>{card.scope}()</span>}
            {card.iteration && <span>Loop iteration {card.iteration}</span>}
          </div>
        )}
        {card.code && (
          <pre className="eh-code">
            <code>{card.code}</code>
          </pre>
        )}
        <p className="eh-explanation">{card.explanation}</p>
        {card.inputs.length > 0 && (
          <div className="eh-inputs">
            {card.inputs.map((input) => (
              <span key={input.name}>
                <code>{input.name}</code>
                <b>=</b>
                <strong>{display(input.value)}</strong>
              </span>
            ))}
          </div>
        )}
        {(card.substitution != null || card.kind === "condition") && (
          <div className="eh-calculation">
            {card.substitution != null && (
              <code>{String(card.substitution)}</code>
            )}
            {card.kind === "condition" && (
              <>
                <span className="eh-arrow">→</span>
                <strong className={card.result ? "eh-true" : "eh-false"}>
                  {String(card.result)}
                </strong>
              </>
            )}
          </div>
        )}
        {changes.length > 0 && <ValueChanges changes={changes} />}
        {card.recheck && (
          <div className="eh-recheck">
            <span>
              <code>{card.recheck.name}--</code>
              <b>{card.recheck.after}</b>
            </span>
            <i>→</i>
            <span>
              <code>loop: {card.recheck.name}++</code>
              <b>{card.recheck.next}</b>
            </span>
            <i>→</i>
            <span>
              Check index <b>{card.recheck.next}</b> again
            </span>
          </div>
        )}
        {card.arrays.map((view) => (
          <div
            className="eh-structure"
            key={`${view.frameId || 0}-${view.name}`}
          >
            <div className="eh-structure-heading">
              <code>{view.name}</code>
              <small>
                {Array.isArray(view.after[0])
                  ? "matrix"
                  : `${view.after.length} items`}
                {view.splice &&
                  ` · length ${view.before.length} → ${view.after.length}`}
              </small>
            </div>
            {view.after.length && view.after.every(Array.isArray) ? (
              <Matrix view={view} />
            ) : (
              <ArrayDiagram {...view} />
            )}
          </div>
        ))}
        {card.string && (
          <div className="eh-structure">
            <div className="eh-structure-heading">
              <code>{card.string.name}</code>
              <small>string · ␠ means a space</small>
            </div>
            <ArrayDiagram
              before={
                card.string.changed ? card.string.before.split("") : undefined
              }
              after={card.string.after.split("")}
              pointer={card.string.index}
              pointerName={card.string.pointerName}
              string
              splice={
                card.string.removedIndex !== undefined
                  ? {
                      start: card.string.removedIndex,
                      count: 1,
                      inserted: [],
                      moves: card.string.before
                        .split("")
                        .flatMap((_, index) =>
                          index > card.string.removedIndex
                            ? [{ from: index, to: index - 1 }]
                            : [],
                        ),
                    }
                  : null
              }
            />
          </div>
        )}
        {card.output.length > 0 && (
          <div className="eh-output">
            <span>Output</span>
            <pre>{card.output.join("\n")}</pre>
          </div>
        )}
        <details className="eh-snapshot">
          <summary>Recorded values</summary>
          <dl>
            {Object.entries(card.snapshot)
              .filter(([, entry]) => entry.type !== "function")
              .map(([name, entry]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>
                    <pre>{display(entry.value)}</pre>
                  </dd>
                </div>
              ))}
          </dl>
          {!Object.keys(card.snapshot).length && (
            <p>No variables in this scope yet.</p>
          )}
        </details>
      </article>
    </li>
  );
});

export default function ExecutionHistory({
  trace,
  source,
  activeStep,
  indices,
  onRevealLine,
}) {
  const cards = useMemo(
    () => buildExecutionHistory(trace, source, indices),
    [trace, source, indices],
  );
  const shown = useMemo(
    () => historyThrough(cards, activeStep),
    [cards, activeStep],
  );
  const scroller = useRef(null);
  const followingRef = useRef(true);
  const lastScrollTop = useRef(0);
  const [following, setFollowing] = useState(true);
  const lastStep = useRef(-1);

  function setFollow(value) {
    followingRef.current = value;
    setFollowing(value);
  }
  function scrollToLatest() {
    const element = scroller.current;
    if (!element) return;
    const latest = element.querySelector(".eh-entry:last-child");
    // Start at the new card's heading; a large card must still be readable from the top.
    if (latest)
      element.scrollTop +=
        latest.getBoundingClientRect().top -
        element.getBoundingClientRect().top -
        12;
    lastScrollTop.current = element.scrollTop;
  }
  useLayoutEffect(() => {
    if (activeStep < lastStep.current) setFollow(true);
    if (followingRef.current) scrollToLatest();
    lastStep.current = activeStep;
  }, [shown, activeStep]);
  useEffect(() => {
    setFollow(true);
    lastStep.current = -1;
    if (scroller.current) {
      scroller.current.scrollTop = 0;
      lastScrollTop.current = 0;
    }
  }, [trace]);
  return (
    <div className="eh-history">
      <header className="eh-header">
        <div>
          <h2>
            Execution history <span>{shown.length}</span>
          </h2>
          <p>Each step stays here. New steps appear below.</p>
        </div>
        <button
          type="button"
          className="eh-follow"
          onClick={() => {
            setFollow(true);
            scrollToLatest();
          }}
          disabled={!shown.length}
          aria-pressed={following}
        >
          {following ? "Following latest ↓" : "Jump to latest ↓"}
        </button>
      </header>
      <div
        ref={scroller}
        className="eh-scroll"
        tabIndex={0}
        aria-label="Execution history. Scroll up to review previous steps."
        onScroll={() => {
          const element = scroller.current;
          if (element.scrollTop < lastScrollTop.current - 4) setFollow(false);
          lastScrollTop.current = element.scrollTop;
        }}
      >
        <div className="eh-content">
          {!shown.length ? (
            <div className="eh-empty">
              <span>{"{ }"}</span>
              <h3>See how your code reaches its result</h3>
              <p>Choose Visualize, then Next Step or Play.</p>
              <p>
                Follow the checks, value changes, and output as a story you can
                scroll back through.
              </p>
              <div>
                <b>1</b> Run a line <i>→</i>
                <b>2</b> See what changed <i>→</i>
                <b>3</b> Keep the earlier steps
              </div>
            </div>
          ) : (
            <>
              <ol className="eh-timeline">
                {shown.map((card) => (
                  <HistoryCard
                    key={card.index}
                    card={card}
                    onRevealLine={onRevealLine}
                  />
                ))}
              </ol>
              <div className="eh-tail">
                {shown.at(-1)?.kind === "error"
                  ? "Execution stopped · all previous steps are kept above"
                  : activeStep >= (trace?.events.length || 0) - 1
                    ? "End of execution · all previous steps are kept above"
                    : "Next Step adds the next part of the story here ↓"}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="eh-status" role="status">
        {shown.length
          ? `Step ${shown.length}: ${shown.at(-1).title}`
          : "Ready to visualize"}
      </div>
    </div>
  );
}
