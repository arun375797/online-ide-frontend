import { useEffect, useState } from "react";

function valueText(value) {
  const text =
    value && typeof value === "object"
      ? JSON.stringify(value)
      : typeof value === "string"
        ? JSON.stringify(value)
        : String(value);
  return text.length > 20 ? `${text.slice(0, 18)}…` : text;
}

export default function CallStackDiagram({
  step,
  previousStep,
  activeStep,
  lesson,
}) {
  const stack = step.callStack || [
    { id: 0, name: "Global", variables: step.variables || {} },
  ];
  const [selected, setSelected] = useState(stack.length - 1);
  const [variablePage, setVariablePage] = useState(0);
  useEffect(() => {
    setSelected(stack.length - 1);
    setVariablePage(0);
  }, [activeStep, stack.length]);
  const selectedIndex = Math.min(selected, stack.length - 1);
  const frames =
    selectedIndex > 0 ? [stack[0], stack[selectedIndex]] : [stack[0]];
  const variablePages = Math.max(
    1,
    ...frames.map((frame) =>
      Math.ceil(
        Object.values(frame.variables).filter(
          (entry) => entry.type !== "function",
        ).length / 6,
      ),
    ),
  );
  const page = Math.min(variablePage, variablePages - 1);
  const calculation = step.calculation;
  const formula =
    step.type === "error"
      ? `Execution stopped at line ${step.line}`
      : calculation
        ? `${valueText(calculation.left)} ${calculation.operator} ${valueText(calculation.right)} = ${valueText(calculation.value)}`
        : step.type === "call"
          ? step.explanation
          : step.type === "return" || step.type === "call-result"
            ? `${step.functionName} → ${valueText(step.returnValue)}`
            : step.condition
              ? `${step.condition} → ${step.result ? "true" : "false"}`
              : lesson?.substitution ||
                (lesson?.primary?.existed
                  ? `${lesson.primary.label}: ${valueText(lesson.primary.before)} → ${valueText(lesson.primary.after)}`
                  : lesson?.title) ||
                step.explanation;
  const width = frames.length === 2 ? 780 : 470;
  const rows = Math.max(
    2,
    ...frames.map((frame) =>
      Math.min(
        6,
        Object.values(frame.variables).filter(
          (entry) => entry.type !== "function",
        ).length,
      ),
    ),
  );
  const cardHeight = rows * 42 + 65;
  const height = cardHeight + 120;
  const maxFormulaCharacters = Math.floor((width - 40) / 8);
  const functions = Object.entries(step.variables || {}).filter(
    ([, entry]) => entry.type === "function",
  );

  return (
    <div className="viz-function-diagram">
      <div className="viz-function-heading">
        <span>
          Call stack <strong>{stack.length}</strong>
        </span>
        <span>
          {stack.length > 1 ? `Active: ${stack.at(-1).name}()` : "Global scope"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="viz-function-svg"
        role="img"
        aria-label={`Call stack: ${stack.map((frame) => frame.name).join(" → ")}. ${formula}`}
      >
        {frames.map((frame, index) => {
          const x = frames.length === 1 ? 60 : index ? 430 : 20;
          const entries = Object.entries(frame.variables)
            .filter(([, entry]) => entry.type !== "function")
            .slice(page * 6, page * 6 + 6);
          const active = frame.id === stack.at(-1).id;
          return (
            <g key={frame.id} transform={`translate(${x}, 20)`}>
              <rect
                width="330"
                height={cardHeight}
                rx="9"
                className={`viz-frame-card ${active ? "is-active" : ""}`}
              />
              <text x="16" y="28" className="viz-frame-name">
                {frame.name}
                {frame.id ? "()" : ""}
              </text>
              <text x="314" y="28" textAnchor="end" className="viz-frame-label">
                {frame.returning
                  ? "returning"
                  : active
                    ? "executing"
                    : "paused"}
              </text>
              <path d="M0 43h330" className="viz-frame-rule" />
              {entries.map(([name, entry], row) => {
                const before = previousStep?.callStack?.find(
                  (previousFrame) => previousFrame.id === frame.id,
                )?.variables[name];
                const changed =
                  !before ||
                  JSON.stringify(before.value) !== JSON.stringify(entry.value);
                return (
                  <g key={name} transform={`translate(16, ${56 + row * 42})`}>
                    <text x="0" y="23" className="viz-frame-variable">
                      {name.length > 12 ? `${name.slice(0, 10)}…` : name}
                    </text>
                    <text x="109" y="23" className="viz-frame-arrow">
                      →
                    </text>
                    <rect
                      x="135"
                      y="0"
                      width="160"
                      height="32"
                      rx="4"
                      className={`viz-frame-value-box ${changed ? "is-changed" : ""}`}
                    />
                    <text
                      x="215"
                      y="22"
                      textAnchor="middle"
                      className="viz-frame-value"
                    >
                      {Array.isArray(entry.value)
                        ? `Array (${entry.value.length})`
                        : changed &&
                            before &&
                            typeof entry.value !== "object" &&
                            String(entry.value).length < 8 &&
                            String(before.value).length < 8
                          ? `${valueText(before.value)} → ${valueText(entry.value)}`
                          : valueText(entry.value)}
                    </text>
                    <title>{`${name}: ${JSON.stringify(entry.value)} (${entry.type})`}</title>
                  </g>
                );
              })}
              {!entries.length && (
                <text
                  x="165"
                  y="88"
                  textAnchor="middle"
                  className="viz-frame-label"
                >
                  No local values declared
                </text>
              )}
            </g>
          );
        })}
        {frames.length === 2 && (
          <g>
            <path
              d={`M350 ${60 + cardHeight / 2}H418l-9-6m9 6-9 6`}
              className="viz-frame-connection"
            />
            <text
              x="390"
              y={47 + cardHeight / 2}
              textAnchor="middle"
              className="viz-frame-label"
            >
              call
            </text>
          </g>
        )}
        <g
          transform={`translate(${width / 2}, ${cardHeight + 80})`}
          className="viz-diagram-calculation"
        >
          <rect
            x={-Math.min(width - 20, Math.max(280, formula.length * 8)) / 2}
            y="-22"
            width={Math.min(width - 20, Math.max(280, formula.length * 8))}
            height="40"
            rx="6"
          />
          <text y="3" textAnchor="middle">
            {formula.length > maxFormulaCharacters
              ? `${formula.slice(0, maxFormulaCharacters - 3)}…`
              : formula}
          </text>
          <title>{formula}</title>
        </g>
      </svg>
      <div className="viz-diagram-navigation">
        <span>
          {functions.length
            ? `Functions: ${functions.map(([name]) => name).join(", ")}`
            : "Each scope keeps its own values"}
        </span>
        {stack.length > 2 && (
          <div>
            <button
              type="button"
              disabled={selectedIndex <= 1}
              onClick={() => setSelected(selectedIndex - 1)}
              aria-label="Previous function frame"
            >
              ←
            </button>
            <span>
              Frame {selectedIndex} / {stack.length - 1}
            </span>
            <button
              type="button"
              disabled={selectedIndex >= stack.length - 1}
              onClick={() => setSelected(selectedIndex + 1)}
              aria-label="Next function frame"
            >
              →
            </button>
          </div>
        )}
        {variablePages > 1 && (
          <div>
            <button
              type="button"
              disabled={!page}
              onClick={() => setVariablePage(page - 1)}
              aria-label="Previous scope variables"
            >
              ←
            </button>
            <span>
              Values {page + 1}/{variablePages}
            </span>
            <button
              type="button"
              disabled={page === variablePages - 1}
              onClick={() => setVariablePage(page + 1)}
              aria-label="Next scope variables"
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
