import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { prefersReducedMotion, useInView } from "#/views/in-view";

// A window with traffic lights and an optional title, such as a file name.
// Code keeps its lines and scrolls sideways; terminal output wraps.
export function Window({
  title,
  scroll,
  children,
}: {
  title?: ReactNode;
  scroll?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-term text-ink shadow-window overflow-hidden">
      <div className="h-9 px-4 flex items-center gap-2 border-b border-rule">
        <span className="shrink-0 w-3 h-3 rounded-full bg-[#ff5f57]" />
        <span className="shrink-0 w-3 h-3 rounded-full bg-[#febc2e]" />
        <span className="shrink-0 w-3 h-3 rounded-full bg-[#28c840]" />
        {typeof title === "string" ? (
          <span className="ml-3 font-mono text-xs text-ink-3">{title}</span>
        ) : (
          title
        )}
      </div>
      <pre
        className={`px-6 py-5 font-mono text-[13px] leading-[1.8] ${scroll ? "whitespace-pre overflow-x-auto" : "whitespace-pre-wrap break-words"}`}
      >
        <code>{children}</code>
      </pre>
    </div>
  );
}

// Enough highlighting for the short TypeScript samples on the landing page:
// comments, strings and a few keywords.
const tokens = /(\/\/.*$)|("[^"]*"|`[^`]*`)|\b(export|default|const|new|import|from)\b/gm;

function highlight(source: string) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of source.matchAll(tokens)) {
    const index = match.index ?? 0;
    parts.push(source.slice(last, index));
    const className = match[1] ? "text-ink-3" : match[2] ? "text-accent-ink" : "text-ink-2";
    parts.push(
      <span key={index} className={className}>
        {match[0]}
      </span>,
    );
    last = index + match[0].length;
  }
  parts.push(source.slice(last));
  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>);
}

export function Code({ title, source }: { title?: string; source: string }) {
  return (
    <Window title={title} scroll>
      {highlight(source)}
    </Window>
  );
}

// `repo` is shown before the file name, dimmed, when files come from different repos.
export type CodeFile = { name: string; repo?: string; source: string };

// Files shown one at a time, with a tab for each file in the title bar.
// Every file is laid out in the same grid cell, so the window takes the
// height of the longest one and does not resize when the tab changes.
export function CodeTabs({ files }: { files: CodeFile[] }) {
  const [active, setActive] = useState(0);
  const tabs = (
    <span role="tablist" className="ml-3 flex gap-1 min-w-0 overflow-x-auto">
      {files.map((file, index) => (
        <button
          key={file.name}
          type="button"
          role="tab"
          aria-selected={index === active}
          onClick={() => setActive(index)}
          className={`rounded-md px-2.5 py-1 font-mono text-xs whitespace-nowrap transition-colors ${
            index === active ? "bg-ink/6 text-ink" : "text-ink-3 hover:text-ink-2"
          }`}
        >
          {file.repo && <span className="text-ink-3">{file.repo}/</span>}
          {file.name}
        </button>
      ))}
    </span>
  );
  return (
    <Window title={tabs} scroll>
      <span className="grid">
        {files.map((file, index) => (
          <span
            key={file.name}
            role="tabpanel"
            aria-hidden={index !== active}
            className={`[grid-area:1/1] ${index === active ? "" : "invisible"}`}
          >
            {highlight(file.source)}
          </span>
        ))}
      </span>
    </Window>
  );
}

function PromptMark({ dir }: { dir?: string }) {
  return <span className="text-accent-ink">{dir ? `${dir} $ ` : "$ "}</span>;
}

function Caret() {
  return (
    <span className="lightbox-caret inline-block w-[0.55em] h-[1.15em] -mb-[0.2em] bg-accent" />
  );
}

export type TermLine = { prompt?: string; text: string; pause?: number };

// Types its commands once it is on screen. Each output line follows after a
// pause. Every line is laid out from the start, unseen, so nothing below
// moves while it types.
export function TypedTerminal({ title, lines }: { title?: string; lines: TermLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.7);
  const [line, setLine] = useState(0);
  const [chars, setChars] = useState(0);

  useEffect(() => {
    if (seen && prefersReducedMotion()) setLine(lines.length);
  }, [seen, lines.length]);

  useEffect(() => {
    if (!seen || line >= lines.length) return;
    const current = lines[line];
    const typing = current.prompt !== undefined && chars < current.text.length;
    if (typing) {
      const timer = window.setTimeout(() => setChars(chars + 1), 22 + Math.random() * 38);
      return () => clearTimeout(timer);
    }
    const next = lines[line + 1];
    const wait =
      line === 0 && chars === 0 ? 500 : next?.prompt !== undefined ? 900 : (next?.pause ?? 350);
    const timer = window.setTimeout(() => {
      setLine(line + 1);
      setChars(next && next.prompt === undefined ? next.text.length : 0);
    }, wait);
    return () => clearTimeout(timer);
  }, [seen, line, chars, lines]);

  const done = line >= lines.length;
  return (
    <div ref={ref}>
      <Window title={title}>
        {lines.map((item, index) => {
          const shown = index < line ? item.text.length : index === line ? chars : 0;
          const visible =
            index < line || (index === line && (item.prompt !== undefined || shown > 0));
          return (
            <span key={index} className={`block ${item.prompt === undefined ? "text-ink-2" : ""}`}>
              <span className={visible ? undefined : "invisible"}>
                {item.prompt !== undefined && <PromptMark dir={item.prompt} />}
                {item.text.slice(0, shown)}
                {index === line && item.prompt !== undefined && <Caret />}
              </span>
              <span className="invisible">{item.text.slice(shown)}</span>
            </span>
          );
        })}
        <span className={`block ${done ? "" : "invisible"}`}>
          <PromptMark dir={lines[0]?.prompt} />
          <Caret />
        </span>
      </Window>
    </div>
  );
}
