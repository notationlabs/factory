import { useEffect, useRef, useState, type ReactNode } from "react";
import { GitHubIcon } from "#/views/icons";
import { prefersReducedMotion, useInView } from "#/views/in-view";

// A GitHub issue where a collaborator mentions @claude. Once the issue is on
// screen, the agent's reply arrives in two steps: first that it has started
// on the branch, then what it did.
export function Issue() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.4);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!seen) return;
    if (prefersReducedMotion()) {
      setStage(2);
      return;
    }
    const timers = [window.setTimeout(() => setStage(1), 900), window.setTimeout(() => setStage(2), 3600)];
    return () => timers.forEach(clearTimeout);
  }, [seen]);

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
            <Mention>@claude</Mention> can you take this one? The total is worked out in{" "}
            <InlineCode>cart/total.ts</InlineCode>.
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
              Discount codes now apply before tax. I added a test in <InlineCode>cart/total.test.ts</InlineCode>{" "}
              and opened <span className="text-link">#43</span>.
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
    <div className={`flex gap-3 ${arriving ? "lightbox-arrive rounded-lg" : ""}`}>
      <span className={`mt-0.5 w-8 h-8 shrink-0 rounded-full ${avatar}`} />
      <div className="flex-1 min-w-0 rounded-lg border border-rule">
        <div className="px-4 py-2 border-b border-rule text-sm text-ink-2">
          <span className="font-medium text-ink">{author}</span>
          {bot && (
            <span className="ml-2 rounded-full border border-rule px-1.5 py-px text-[11px] text-ink-3">bot</span>
          )}
        </div>
        <div className="px-4 py-3 text-[15px] leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Mention({ children }: { children: ReactNode }) {
  return <span className="font-semibold">{children}</span>;
}

function InlineCode({ children }: { children: ReactNode }) {
  return <code className="rounded bg-ink/6 px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>;
}
