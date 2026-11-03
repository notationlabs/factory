import { useEffect, useRef, useState, type ReactNode } from "react";
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

function PromptMark({ prompt }: { prompt?: string }) {
  return <span className="text-accent-ink">{prompt ?? "$"} </span>;
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
                {item.prompt !== undefined && <PromptMark prompt={item.prompt} />}
                {item.text.slice(0, shown)}
                {index === line && item.prompt !== undefined && <Caret />}
              </span>
              <span className="invisible">{item.text.slice(shown)}</span>
            </span>
          );
        })}
        <span className={`block ${done ? "" : "invisible"}`}>
          <PromptMark prompt={[...lines].reverse().find((item) => item.prompt !== undefined)?.prompt} />
          <Caret />
        </span>
      </Window>
    </div>
  );
}
