import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AgentIcon, ContainerIcon, GitHubIcon, HubIcon } from "#/views/icons";
import { SlackMark } from "#/views/scenes";
import { prefersReducedMotion, useInView } from "#/views/in-view";

type Conversation = {
  platform: "github" | "slack";
  title: string;
  place: string;
  branch: string;
};

const conversations: Conversation[] = [
  { platform: "github", title: "Issue #42", place: "acme/webapp", branch: "issue-42" },
  { platform: "slack", title: "Thread", place: "#ops", branch: "ops-1718" },
  { platform: "github", title: "Issue #57", place: "acme/webapp", branch: "issue-57" },
];

// 0: the event travels to the container. 1: the agent works.
// 2: the reply travels back. 3: a pause before the next conversation.
const phaseLengths = [1700, 1500, 1700, 700];

const travel = phaseLengths[0];

// Several conversations on the left, the hub in the middle, and one agent
// per conversation in the container on the right. In turn, each
// conversation sends an event through the hub to its agent, the agent
// works, and its reply travels back to the conversation.
export function Flow() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.4);
  const { paths, anchors } = usePaths(ref);
  const [still, setStill] = useState(false);
  const [step, setStep] = useState({ row: 0, phase: -1 });

  useEffect(() => {
    if (seen) setStill(prefersReducedMotion());
  }, [seen]);

  useEffect(() => {
    if (!seen || still) return;
    const timer = window.setTimeout(
      () =>
        setStep(({ row, phase }) =>
          phase === phaseLengths.length - 1
            ? { row: (row + 1) % conversations.length, phase: 0 }
            : { row, phase: phase + 1 },
        ),
      step.phase < 0 ? 400 : phaseLengths[step.phase],
    );
    return () => clearTimeout(timer);
  }, [seen, still, step]);

  const active = (row: number) => !still && step.row === row && step.phase >= 0 && step.phase < 3;

  return (
    <div className="rounded-2xl bg-card shadow-window px-4 py-8 sm:px-10 sm:py-10">
      <div className="grid grid-cols-3 gap-x-6 sm:gap-x-12">
        <Heading>Channels</Heading>
        <Heading>Hub</Heading>
        <Heading>Outpost</Heading>
      </div>

      <div ref={ref} className="relative mt-5 grid grid-cols-3 gap-x-6 sm:gap-x-12 items-center">
        <svg className="absolute inset-0 w-full h-full overflow-visible" aria-hidden>
          {paths.map((d, row) => (
            <g key={row}>
              <path d={d} fill="none" strokeWidth="1.5" className="stroke-rule" />
              <path
                d={d}
                fill="none"
                strokeWidth="1.5"
                className={`stroke-accent-soft transition-opacity duration-500 ${active(row) ? "opacity-100" : "opacity-0"}`}
              />
            </g>
          ))}
        </svg>

        {!still && step.phase >= 0 && paths[step.row] && (step.phase === 0 || step.phase === 2) && (
          <span
            key={`${step.row}-${step.phase}`}
            aria-hidden
            style={{
              offsetPath: `path("${paths[step.row]}")`,
              animationDuration: `${travel}ms`,
              animationDirection: step.phase === 2 ? "reverse" : "normal",
            }}
            className={`lightbox-along absolute top-0 left-0 w-2.5 h-2.5 rounded-full shadow-[0_0_0_4px_var(--color-card)] ${step.phase === 2 ? "bg-link" : "bg-accent"}`}
          />
        )}

        <div className="relative flex flex-col gap-3">
          {conversations.map((conversation, row) => (
            <Source
              key={row}
              conversation={conversation}
              anchor={(element) => (anchors.sources[row] = element)}
              replied={!still && step.row === row && step.phase === 3}
            />
          ))}
        </div>

        <div className="relative flex justify-center">
          <div
            ref={(element) => {
              anchors.hub = element;
            }}
            className="flex flex-col items-center gap-2 rounded-2xl bg-card border border-rule px-3 py-4 sm:px-5"
          >
            <HubIcon className="w-7 h-7 text-accent" />
            <span className="font-mono text-[11px] text-ink-3">router</span>
          </div>
        </div>

        <div className="relative rounded-xl border border-dashed border-ink/20 bg-card p-2 sm:p-3">
          <div className="flex items-center gap-1.5 px-1 pb-2 text-ink-2">
            <ContainerIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono text-[11px] truncate">dev container</span>
          </div>
          <div className="flex flex-col gap-2">
            {conversations.map((conversation, row) => (
              <Worktree
                key={row}
                branch={conversation.branch}
                anchor={(element) => (anchors.worktrees[row] = element)}
                running={!still && step.row === row && step.phase === 1}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-x-12 gap-y-3 text-sm leading-relaxed text-ink-2">
        <p>Someone mentions the agent on an issue or in a thread.</p>
        <p>The hub's router matches the event to a trigger in the repo's outpost.</p>
        <p>Each conversation gets its own agent and branch. The agent replies where it was asked.</p>
      </div>
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 text-center sm:text-left">
      {children}
    </p>
  );
}

function Source({
  conversation,
  anchor,
  replied,
}: {
  conversation: Conversation;
  anchor: (element: HTMLDivElement | null) => void;
  replied: boolean;
}) {
  return (
    <div
      ref={anchor}
      key={replied ? "replied" : "waiting"}
      className={`flex items-center gap-2.5 rounded-xl bg-card border border-rule px-2.5 py-2 sm:px-3 ${replied ? "lightbox-flash" : ""}`}
    >
      <span
        className={`w-6 h-6 shrink-0 rounded-md p-1 text-white ${conversation.platform === "github" ? "bg-[#24292f]" : "bg-white"}`}
      >
        {conversation.platform === "github" ? <GitHubIcon /> : <SlackMark className="block w-full h-full" />}
      </span>
      <span className="min-w-0 flex flex-col">
        <span className="text-[13px] font-medium truncate">{conversation.title}</span>
        <span className="hidden sm:block font-mono text-[11px] text-ink-3 truncate">{conversation.place}</span>
      </span>
    </div>
  );
}

function Worktree({
  branch,
  anchor,
  running,
}: {
  branch: string;
  anchor: (element: HTMLDivElement | null) => void;
  running: boolean;
}) {
  return (
    <div
      ref={anchor}
      className={`flex flex-col gap-1 rounded-lg border px-2.5 py-2 transition-colors duration-300 ${running ? "border-accent-soft bg-accent-soft/25" : "border-rule bg-paper"}`}
    >
      <span className="font-mono text-[12px] truncate">{branch}</span>
      <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
        <span className={`w-3 h-3 shrink-0 rounded-[3px] p-[2px] text-white bg-[#d97757] ${running ? "lightbox-pulse" : ""}`}>
          <AgentIcon />
        </span>
        <span className="truncate">{running ? "working" : "coder"}</span>
      </span>
    </div>
  );
}

type Anchors = {
  sources: (HTMLElement | null)[];
  hub: HTMLElement | null;
  worktrees: (HTMLElement | null)[];
};

// The route from each conversation through the hub to its worktree, in the
// container's pixel coordinates. The anchors are filled in by ref callbacks
// during render, and the routes are measured after layout and on resize.
function usePaths(ref: RefObject<HTMLDivElement | null>) {
  const anchors = useRef<Anchors>({ sources: [], hub: null, worktrees: [] }).current;
  const [paths, setPaths] = useState<string[]>([]);

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const measure = () => {
      const origin = container.getBoundingClientRect();
      const hub = anchors.hub?.getBoundingClientRect();
      if (!hub) return;
      const hubY = hub.top + hub.height / 2 - origin.top;
      const hubLeft = hub.left - origin.left;
      const hubRight = hub.right - origin.left;
      setPaths(
        conversations.map((_, row) => {
          const source = anchors.sources[row]?.getBoundingClientRect();
          const worktree = anchors.worktrees[row]?.getBoundingClientRect();
          if (!source || !worktree) return "";
          const sx = source.right - origin.left;
          const sy = source.top + source.height / 2 - origin.top;
          const wx = worktree.left - origin.left;
          const wy = worktree.top + worktree.height / 2 - origin.top;
          const inBend = (sx + hubLeft) / 2;
          const outBend = (hubRight + wx) / 2;
          return [
            `M ${sx} ${sy}`,
            `C ${inBend} ${sy} ${inBend} ${hubY} ${hubLeft} ${hubY}`,
            `L ${hubRight} ${hubY}`,
            `C ${outBend} ${hubY} ${outBend} ${wy} ${wx} ${wy}`,
          ].join(" ");
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [ref, anchors]);

  return { paths, anchors };
}
