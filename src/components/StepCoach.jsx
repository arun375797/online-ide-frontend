import { lessonValue } from "../lib/executionLesson.js";

const LABELS = {
  ready: "GET STARTED",
  create: "STORE A VALUE",
  change: "CHANGE A VALUE",
  condition: "MAKE A DECISION",
  call: "CALL A FUNCTION",
  return: "RETURN A VALUE",
  output: "PRINT A VALUE",
  loop: "REPEAT",
  define: "SAVE INSTRUCTIONS",
  scope: "LEAVE A SCOPE",
  complete: "FINISHED",
  error: "CHECK THIS LINE",
  observe: "FOLLOW THE CODE",
};

export default function StepCoach({
  lesson,
  step,
  position,
  total,
  playing,
  tracing,
  error,
}) {
  const change = lesson.primary;
  const reads =
    lesson.reads?.filter((read) => read.value !== undefined).slice(0, 3) || [];
  return (
    <section
      className={`viz-step-card viz-coach ${lesson.kind === "error" ? "is-error" : ""}`}
      aria-label="Step explanation"
      aria-live={playing ? "off" : "polite"}
      aria-atomic="true"
    >
      <div className="viz-step-meta">
        <span>
          {step ? `STEP ${position + 1} OF ${total}` : "YOUR NEXT STEP"}
          <span className="viz-coach-category">{LABELS[lesson.kind]}</span>
        </span>
        {step && <span className="viz-line-badge">Line {step.line}</span>}
      </div>
      <h3>
        {tracing ? "Preparing your step-by-step walkthrough…" : lesson.title}
      </h3>
      <p role={lesson.kind === "error" ? "alert" : undefined}>
        {tracing
          ? "Your code is running. We’re recording the values so you can replay every change."
          : lesson.explanation}
      </p>
      {step && lesson.kind !== "error" && lesson.code && (
        <div className="viz-coach-equation">
          <code title={lesson.code}>{lesson.code.replace(/\r?\n/g, " ")}</code>
          {lesson.substitution != null && (
            <>
              <span className="viz-coach-equals" aria-hidden="true">
                →
              </span>
              <code
                className="viz-coach-resolved"
                title={String(lesson.substitution)}
              >
                {String(lesson.substitution)}
              </code>
            </>
          )}
          {lesson.kind === "condition" && (
            <span
              className={`viz-coach-decision ${lesson.result ? "is-true" : "is-false"}`}
            >
              {lesson.result ? "YES · true" : "NO · false"}
            </span>
          )}
        </div>
      )}
      {reads.length > 0 && lesson.kind === "change" ? (
        <div className="viz-coach-reads">
          <span>Read</span>
          {reads.map((read, index) => (
            <code key={index}>
              {read.name}
              {read.path.map((key) => `[${key}]`).join("")} ={" "}
              {lessonValue(read.value, 20)}
            </code>
          ))}
        </div>
      ) : (
        lesson.inputs?.length > 0 && (
          <div className="viz-coach-reads">
            <span>Use</span>
            {lesson.inputs.map((input) => (
              <code key={input.name}>
                {input.name} = {lessonValue(input.value, 24)}
              </code>
            ))}
          </div>
        )
      )}
      {change &&
        !["condition", "call", "return", "complete", "error"].includes(
          lesson.kind,
        ) && (
          <div
            className="viz-coach-change"
            key={`${step?.step}-${change.label}`}
          >
            <strong title={`${change.scope}: ${change.label}`}>
              {change.label}
            </strong>
            <div>
              <span>BEFORE</span>
              <code
                title={
                  change.existed
                    ? lessonValue(change.before, 4000)
                    : "Not created yet"
                }
              >
                {change.existed
                  ? lessonValue(change.before, 40)
                  : "not created yet"}
              </code>
            </div>
            <b aria-hidden="true">→</b>
            <div>
              <span>AFTER</span>
              <code title={lessonValue(change.after, 4000)}>
                {lessonValue(change.after, 40)}
              </code>
            </div>
            {lesson.changes.filter((item) => item.kind !== "removed").length >
              1 && (
              <small>
                +
                {lesson.changes.filter((item) => item.kind !== "removed")
                  .length - 1}{" "}
                changes
              </small>
            )}
          </div>
        )}
      {error && (
        <div className="viz-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
