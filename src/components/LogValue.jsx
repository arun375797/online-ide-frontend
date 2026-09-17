import { useState } from "react";

function quoteString(value) {
  return JSON.stringify(value);
}

function KindBadge({ kind }) {
  const label = kind === "result" ? "←" : kind;
  const color =
    kind === "error"
      ? "text-danger"
      : kind === "warn"
        ? "text-orange"
        : kind === "result"
          ? "text-lime"
          : kind === "info" || kind === "system"
            ? "text-cyan"
            : "text-muted";
  return <span className={`w-12 shrink-0 pt-[1px] text-[10px] font-semibold tracking-wide ${color}`}>{label}</span>;
}

function Punct({ children }) {
  return <span className="text-muted/80">{children}</span>;
}

function ObjectPreview({ node, expanded, onToggle }) {
  const name = node.name ? `${node.name} ` : "";
  const props = node.props || [];
  return (
    <span className="inline">
      <button type="button" className="mr-1 inline-flex h-3 w-3 items-center justify-center text-[9px] text-muted hover:text-white" onClick={onToggle} aria-label={expanded ? "Collapse" : "Expand"}>
        {expanded ? "▾" : "▸"}
      </button>
      <span className="text-cyan/80">{name}</span>
      <Punct>{"{"}</Punct>
      {!expanded &&
        props.slice(0, 4).map((prop, i) => (
          <span key={i}>
            {i > 0 ? <Punct>, </Punct> : null}
            <span className="text-white/80">{prop.k}</span>
            <Punct>: </Punct>
            <LogValue node={prop.v} />
          </span>
        ))}
      {!expanded && props.length > 4 ? <Punct>, …</Punct> : null}
      <Punct>{"}"}</Punct>
    </span>
  );
}

function ArrayPreview({ node, expanded, onToggle }) {
  const items = node.items || [];
  return (
    <span className="inline">
      <button type="button" className="mr-1 inline-flex h-3 w-3 items-center justify-center text-[9px] text-muted hover:text-white" onClick={onToggle} aria-label={expanded ? "Collapse" : "Expand"}>
        {expanded ? "▾" : "▸"}
      </button>
      <Punct>{"["}</Punct>
      {!expanded &&
        items.slice(0, 8).map((item, i) => (
          <span key={i}>
            {i > 0 ? <Punct>, </Punct> : null}
            <LogValue node={item} />
          </span>
        ))}
      {!expanded && (node.more || items.length > 8) ? <Punct>, …</Punct> : null}
      <Punct>{"]"}</Punct>
      <span className="ml-1 text-[10px] text-muted">{node.length ?? items.length}</span>
    </span>
  );
}

export function LogValue({ node, quoted = true }) {
  const [open, setOpen] = useState(false);
  if (!node || typeof node !== "object") return <span className="text-white">{String(node ?? "")}</span>;

  switch (node.t) {
    case "string":
      return quoted ? (
        <span className="text-yellow">{quoteString(node.v)}</span>
      ) : (
        <span className="whitespace-pre text-white">{node.v}</span>
      );
    case "number":
      return <span className="text-orange">{node.v}</span>;
    case "bigint":
      return <span className="text-orange">{node.v}n</span>;
    case "boolean":
    case "null":
    case "undefined":
      return <span className="text-danger">{node.t === "boolean" ? node.v : node.t}</span>;
    case "symbol":
    case "function":
    case "regexp":
    case "date":
      return <span className={node.t === "function" ? "italic text-cyan" : "text-cyan"}>{node.v}</span>;
    case "error":
      return <span className="whitespace-pre-wrap text-danger">{node.v}</span>;
    case "circular":
      return <span className="italic text-muted">[Circular]</span>;
    case "ellipsis":
      return <span className="text-muted">…</span>;
    case "plain":
      return <span className="whitespace-pre-wrap text-white/90">{node.v}</span>;
    case "array": {
      const items = node.items || [];
      return (
        <span className="align-top">
          <ArrayPreview node={node} expanded={open} onToggle={() => setOpen((v) => !v)} />
          {open ? (
            <span className="mt-0.5 block pl-4">
              {items.map((item, i) => (
                <span key={i} className="block">
                  <span className="mr-2 text-muted">{i}:</span>
                  <LogValue node={item} />
                </span>
              ))}
              {node.more ? <span className="text-muted">… {node.more} more</span> : null}
            </span>
          ) : null}
        </span>
      );
    }
    case "object": {
      const props = node.props || [];
      return (
        <span className="align-top">
          <ObjectPreview node={node} expanded={open} onToggle={() => setOpen((v) => !v)} />
          {open ? (
            <span className="mt-0.5 block pl-4">
              {props.map((prop, i) => (
                <span key={i} className="block">
                  <span className="text-white/80">{prop.k}</span>
                  <Punct>: </Punct>
                  <LogValue node={prop.v} />
                </span>
              ))}
              {node.more ? <span className="text-muted">… {node.more} more</span> : null}
            </span>
          ) : null}
        </span>
      );
    }
    default:
      return <span className="text-white">{node.v != null ? String(node.v) : ""}</span>;
  }
}

export function LogLine({ row }) {
  const args =
    Array.isArray(row.args) && row.args.length
      ? row.args
      : row.text != null
        ? [{ t: row.kind === "system" ? "plain" : "string", v: row.text }]
        : [];
  const tone =
    row.kind === "error"
      ? "bg-danger/5"
      : row.kind === "warn"
        ? "bg-orange/5"
        : "";

  return (
    <div className={`flex items-start gap-2 border-b border-white/5 px-1 py-[3px] font-mono text-[12px] leading-[18px] ${tone}`}>
      <KindBadge kind={row.kind} />
      <div className="min-w-0 flex-1 overflow-x-auto whitespace-pre">
        {args.map((arg, i) => (
          <span key={i}>
            {i > 0 ? " " : null}
            <LogValue node={arg} quoted={false} />
          </span>
        ))}
      </div>
      {row.file ? <span className="hidden shrink-0 pt-[1px] text-[10px] text-muted/70 sm:inline">{row.file}</span> : null}
    </div>
  );
}
