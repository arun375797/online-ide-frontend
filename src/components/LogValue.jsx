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

function MapPreview({ node }) {
  const entries = node.entries || [];
  return (
    <span>
      <span className="text-cyan">Map({node.size})</span>
      <Punct>{" {"}</Punct>
      {entries.slice(0, 8).map((entry, index) => (
        <span key={index}>
          {index ? <Punct>, </Punct> : null}
          <LogValue node={entry.k} />
          <Punct> =&gt; </Punct>
          <LogValue node={entry.v} />
        </span>
      ))}
      {node.more ? <Punct>, … {node.more} more</Punct> : null}
      <Punct>{"}"}</Punct>
    </span>
  );
}

function SetPreview({ node }) {
  const items = node.items || [];
  return (
    <span>
      <span className="text-cyan">Set({node.size})</span>
      <Punct>{" {"}</Punct>
      {items.slice(0, 12).map((item, index) => (
        <span key={index}>
          {index ? <Punct>, </Punct> : null}
          <LogValue node={item} />
        </span>
      ))}
      {node.more ? <Punct>, … {node.more} more</Punct> : null}
      <Punct>{"}"}</Punct>
    </span>
  );
}

function TableOutput({ node }) {
  let columns = [];
  let rows = [];
  if (node?.t === "array") {
    const items = node.items || [];
    const columnSet = new Set();
    items.forEach((item) => {
      if (item?.t === "object") (item.props || []).forEach((prop) => columnSet.add(prop.k));
    });
    columns = columnSet.size ? [...columnSet] : ["Value"];
    rows = items.map((item, index) => {
      const values = {};
      if (item?.t === "object") (item.props || []).forEach((prop) => { values[prop.k] = prop.v; });
      else values.Value = item;
      return { index, values };
    });
  } else if (node?.t === "map") {
    columns = ["Key", "Value"];
    rows = (node.entries || []).map((entry, index) => ({ index, values: { Key: entry.k, Value: entry.v } }));
  } else if (node?.t === "set") {
    columns = ["Value"];
    rows = (node.items || []).map((item, index) => ({ index, values: { Value: item } }));
  } else if (node?.t === "object") {
    columns = ["Value"];
    rows = (node.props || []).map((prop) => ({ index: prop.k, values: { Value: prop.v } }));
  } else {
    columns = ["Value"];
    rows = [{ index: 0, values: { Value: node } }];
  }

  return (
    <div className="max-w-full overflow-x-auto py-1">
      <table className="border-collapse text-left font-mono text-xs">
        <thead>
          <tr>
            <th className="border border-cyan/20 bg-widget px-2 py-1 text-muted">(index)</th>
            {columns.map((column) => <th key={column} className="border border-cyan/20 bg-widget px-2 py-1 text-cyan">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.index)}>
              <td className="border border-cyan/20 px-2 py-1 text-muted">{row.index}</td>
              {columns.map((column) => (
                <td key={column} className="border border-cyan/20 px-2 py-1"><LogValue node={row.values[column] || { t: "empty" }} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
    case "accessor":
    case "unavailable":
    case "promise":
      return <span className="italic text-muted">{node.v}</span>;
    case "empty":
      return <span className="italic text-muted">&lt;empty&gt;</span>;
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
    case "map":
      return <MapPreview node={node} />;
    case "set":
      return <SetPreview node={node} />;
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
  if (row.kind === "table") {
    return (
      <div className="border-b border-white/5 px-1 py-1" style={{ paddingLeft: `${4 + (row.indent || 0) * 16}px` }}>
        <TableOutput node={row.args?.[0]} />
      </div>
    );
  }
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
    <div className={`flex items-start gap-2 border-b border-white/5 px-1 py-[3px] font-mono text-[12px] leading-[18px] ${tone}`} style={{ paddingLeft: `${4 + (row.indent || 0) * 16}px` }}>
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
