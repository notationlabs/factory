import { useEffect, useRef, useState, type ReactNode } from "react";
import { GitHubIcon } from "#/views/icons";
import { prefersReducedMotion, useInView } from "#/views/in-view";

type Segment = { text: string; kind?: "mention" | "code" };

const request: Segment[] = [
  { text: "@claude", kind: "mention" },
  { text: " can you take this one? The total is worked out in " },
  { text: "cart/total.ts", kind: "code" },
  { text: "." },
];

const requestLength = request.reduce((total, segment) => total + segment.text.length, 0);

// A GitHub issue where a collaborator mentions @claude. Once the issue is on
// screen, the collaborator's comment types out, and then the agent's reply
// arrives in two steps: first that it has started on the branch, then what
// it did.
export function Issue() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.4);
  const [typed, setTyped] = useState(0);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (seen && prefersReducedMotion()) {
      setTyped(requestLength);
      setStage(2);
    }
  }, [seen]);

  useEffect(() => {
    if (!seen || typed >= requestLength) return;
    const timer = window.setTimeout(
      () => setTyped(typed + 1),
      typed === 0 ? 500 : 22 + Math.random() * 38,
    );
    return () => clearTimeout(timer);
  }, [seen, typed]);

  useEffect(() => {
    if (typed < requestLength || stage > 0) return;
    const timers = [
      window.setTimeout(() => setStage(1), 700),
      window.setTimeout(() => setStage(2), 3400),
    ];
    return () => timers.forEach(clearTimeout);
  }, [typed, stage]);

  return (
    <div ref={ref} className="rounded-xl bg-card shadow-window overflow-hidden text-ink">
      <div className="h-11 px-5 flex items-center gap-2.5 border-b border-rule text-ink-2">
        <GitHubIcon className="w-4 h-4" />
        <span className="font-mono text-xs">acme/webapp</span>
      </div>
      <div className="px-5 sm:px-7 pt-6 pb-7">
        <h3 className="text-xl sm:text-2xl font-semibold tracking-tight">
          Checkout total ignores discount codes <span className="font-normal text-ink-3">#42</span>
        </h3>
        <p className="mt-2.5 flex items-center gap-2 text-sm text-ink-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1f883d] px-2.5 py-0.5 text-xs font-medium text-white">
            Open
          </span>
          <span>
            <span className="font-medium text-ink">alice</span> opened this issue
          </span>
        </p>
        {/* The thread reserves room for the final reply, so the page below does not move. */}
        <div className="mt-6 flex flex-col gap-4 min-h-[290px] sm:min-h-[220px]">
          <Comment author="alice" avatar="bg-[#8b5cf6]">
            <Typed segments={request} count={typed} />
          </Comment>
          {stage === 1 && (
            <Comment author="acme-agents" bot avatar="bg-accent" arriving>
              <span className="inline-flex items-center gap-2 text-ink-2">
                <span className="lightbox-pulse w-2 h-2 rounded-full bg-accent" />
                Working on branch <InlineCode>issue-42</InlineCode>
              </span>
            </Comment>
          )}
          {stage === 2 && (
            <Comment author="acme-agents" bot avatar="bg-accent" arriving>
              Discount codes now apply before tax. I added a test in{" "}
              <InlineCode>cart/total.test.ts</InlineCode> and opened{" "}
              <span className="text-link">#43</span>.
              <span className="mt-3 block font-mono text-xs text-ink-3">
                To take over: lightbox container resume 42
              </span>
            </Comment>
          )}
        </div>
      </div>
    </div>
  );
}

function Comment({
  author,
  avatar,
  bot,
  arriving,
  children,
}: {
  author: string;
  avatar: string;
  bot?: boolean;
  arriving?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex gap-3 ${arriving ? "lightbox-arrive" : ""}`}>
      <span className={`mt-0.5 w-8 h-8 shrink-0 rounded-full ${avatar}`} />
      <div
        className={`flex-1 min-w-0 rounded-lg border border-rule ${arriving ? "lightbox-flash" : ""}`}
      >
        <div className="px-4 py-2 border-b border-rule text-sm text-ink-2">
          <span className="font-medium text-ink">{author}</span>
          {bot && (
            <span className="ml-2 rounded-full border border-rule px-1.5 py-px text-[11px] text-ink-3">
              bot
            </span>
          )}
        </div>
        <div className="px-4 py-3 text-[15px] leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

// The first `count` characters of the segments, with a caret after them
// while typing. The rest is laid out unseen, so the comment keeps its size.
// A code segment keeps its padding from the start and gains its background
// once it is typed in full.
function Typed({ segments, count }: { segments: Segment[]; count: number }) {
  const total = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  let start = 0;
  return segments.map((segment, index) => {
    const shown = Math.max(0, Math.min(segment.text.length, count - start));
    const caret = count < total && count >= start && count < start + segment.text.length;
    start += segment.text.length;
    const content = (
      <>
        {segment.text.slice(0, shown)}
        {caret && (
          <span className="lightbox-caret inline-block w-px h-[1.1em] -mb-[0.2em] bg-ink" />
        )}
        <span className="invisible">{segment.text.slice(shown)}</span>
      </>
    );
    if (segment.kind === "mention")
      return (
        <span key={index} className="font-semibold">
          {content}
        </span>
      );
    if (segment.kind === "code")
      return (
        <InlineCode key={index} filled={shown === segment.text.length}>
          {content}
        </InlineCode>
      );
    return <span key={index}>{content}</span>;
  });
}

function InlineCode({ filled = true, children }: { filled?: boolean; children: ReactNode }) {
  return (
    <code className={`rounded px-1.5 py-0.5 font-mono text-[0.85em] ${filled ? "bg-ink/6" : ""}`}>
      {children}
    </code>
  );
}
