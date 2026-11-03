import { useEffect, useRef, useState, type ReactNode } from "react";
import { GitHubIcon } from "#/views/icons";
import { prefersReducedMotion, useInView } from "#/views/in-view";

// Steps through a scene once it is on screen. `durations[i]` is how long step
// `i` is held. After the last step it starts again at 0. Under reduced motion
// it stays on step `still`.
function useSteps(durations: number[], still = durations.length - 1) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.35);
  const [step, setStep] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (seen) setReduced(prefersReducedMotion());
  }, [seen]);

  useEffect(() => {
    if (!seen || reduced) return;
    const timer = window.setTimeout(
      () => setStep((step + 1) % durations.length),
      durations[step],
    );
    return () => clearTimeout(timer);
  }, [seen, reduced, step, durations]);

  return [ref, reduced ? still : step] as const;
}

function SlackMark({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="2" y="8.5" width="12" height="3.6" rx="1.8" fill="#36c5f0" />
      <rect x="11.9" y="2" width="3.6" height="12" rx="1.8" fill="#2eb67d" />
      <rect x="10" y="11.9" width="12" height="3.6" rx="1.8" fill="#ecb22e" />
      <rect x="8.5" y="10" width="3.6" height="12" rx="1.8" fill="#e01e5a" />
    </svg>
  );
}

function Source({ kind }: { kind: "github" | "slack" }) {
  return kind === "github" ? (
    <GitHubIcon className="w-4 h-4 text-ink" />
  ) : (
    <SlackMark />
  );
}

export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-rule bg-ink/[0.06] px-1 font-mono text-[11px] text-ink-2 shadow-[inset_0_-1px_0_var(--color-rule)]">
      {children}
    </kbd>
  );
}

// A window in the style of a launcher: a title bar, the content, and a bar
// along the bottom with a label on the left and an action with its keys on
// the right.
function Panel({
  title,
  status,
  footer,
  action,
  className = "",
  children,
}: {
  title: ReactNode;
  status?: ReactNode;
  footer: ReactNode;
  action?: { label: string; keys: string[] };
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`w-full rounded-xl bg-term text-ink shadow-window overflow-hidden ${className}`}>
      <div className="h-11 px-4 flex items-center gap-2.5 border-b border-rule">
        <span className="min-w-0 flex-1 truncate flex items-center gap-2.5 font-mono text-xs text-ink-2">
          {title}
        </span>
        {status}
      </div>
      {children}
      <div className="h-10 px-4 flex items-center gap-3 border-t border-rule bg-ink/[0.03] text-xs">
        <span className="min-w-0 flex-1 truncate font-mono text-ink-3">{footer}</span>
        {action && (
          <span className="hidden sm:flex shrink-0 items-center gap-2 text-ink-2">
            {action.label}
            <span className="flex gap-1">
              {action.keys.map((key) => (
                <Key key={key}>{key}</Key>
              ))}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

function Live({ children, pulse = true }: { children: ReactNode; pulse?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-ink-2">
      <span className={`w-1.5 h-1.5 rounded-full bg-accent ${pulse ? "lightbox-pulse" : ""}`} />
      {children}
    </span>
  );
}

const shown = (visible: boolean) =>
  `transition-[opacity,translate] duration-500 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"}`;

const heroLog = [
  { text: "Checked out issue-42 in /data/worktrees/issue-42" },
  { text: "Read cart/total.ts" },
  { text: "Edited cart/total.ts", note: "+6 −2" },
  { text: "Ran npm test", note: "14 passed" },
  { text: "Pushed 3f9c2e1 to issue-42" },
];

const heroDurations = [1600, 1300, 800, 700, 900, 900, 1000, 1200, 4200];

// The whole loop in one picture. A comment on an issue wakes a container,
// the agent's steps appear in the container one by one, and its reply goes
// back to the issue.
export function Dispatch() {
  const [ref, step] = useSteps(heroDurations);
  const awake = step >= 1;
  const lines = Math.max(0, step - 1);
  const replied = step >= 7;
  const state = !awake ? "asleep" : step === 1 ? "waking" : replied ? "idle" : "running";
  return (
    <div ref={ref} className="w-full flex flex-col text-ink">
      <Thread
        author="alice"
        avatar="bg-[#8b5cf6]"
        where="acme/webapp #42"
        text={
          <>
            <b className="font-semibold">@claude</b> can you take this one?
          </>
        }
      />
      <Wire lit={awake} label="router · trigger mention" />
      <div
        className={`rounded-xl border border-transparent overflow-hidden transition-shadow duration-700 [background:linear-gradient(var(--color-term),var(--color-term))_padding-box,linear-gradient(140deg,#ffc078,#fe5537_40%,#5c1004)_border-box] ${awake ? "shadow-[0_0_48px_-8px_rgb(254_85_55/0.55)]" : "shadow-window"}`}
      >
        <div className="h-10 px-4 flex items-center gap-2.5 border-b border-rule font-mono text-xs text-ink-2">
          <span className="flex-1 truncate">
            <span className="text-ink">dev</span> · acme/webapp · coder
          </span>
          <Live pulse={state === "running" || state === "waking"}>{state}</Live>
        </div>
        <ol className="px-4 py-3 font-mono text-[12.5px] leading-[1.9]">
          {heroLog.map((line, index) => (
            <li key={line.text} className={`flex gap-2 ${shown(index < lines)}`}>
              <span className="text-accent-ink">›</span>
              <span className="flex-1 min-w-0 truncate">{line.text}</span>
              {line.note && <span className="text-ink-3">{line.note}</span>}
            </li>
          ))}
        </ol>
      </div>
      <Wire lit={replied} label="reply · acme/webapp #42" />
      <div className={shown(replied)}>
        <Thread
          author="acme-agents"
          bot
          avatar="bg-accent"
          where="acme/webapp #42"
          text="Discount codes now apply before tax. I opened #43."
        />
      </div>
    </div>
  );
}

function Thread({
  author,
  avatar,
  bot,
  where,
  text,
}: {
  author: string;
  avatar: string;
  bot?: boolean;
  where: string;
  text: ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-xl bg-term px-4 py-3 shadow-window">
      <span className={`mt-0.5 w-7 h-7 shrink-0 rounded-full ${avatar}`} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-xs text-ink-3">
          <GitHubIcon className="w-3.5 h-3.5 shrink-0 text-ink-2" />
          <span className="shrink-0 font-medium text-ink">{author}</span>
          {bot && (
            <span className="shrink-0 rounded-full border border-rule px-1.5 text-[10px]">bot</span>
          )}
          <span className="min-w-0 font-mono truncate">{where}</span>
        </p>
        <p className="mt-1 text-[14px] leading-snug">{text}</p>
      </div>
    </div>
  );
}

// A short vertical line between two cards, with a label beside it. It turns
// to the accent colour when something has passed along it.
function Wire({ lit, label }: { lit: boolean; label: string }) {
  return (
    <div className="h-10 ml-[29px] flex items-center gap-3">
      <span
        className={`w-px h-full transition-colors duration-500 ${lit ? "bg-accent shadow-[0_0_8px_#fe5537]" : "bg-rule"}`}
      />
      <span
        className={`font-mono text-[11px] transition-colors duration-500 ${lit ? "text-accent-ink" : "text-ink-3"}`}
      >
        {label}
      </span>
    </div>
  );
}

type RoutedEvent = {
  source: "github" | "slack";
  where: string;
  author: string;
  text: string;
  match?: string;
  reason?: string;
};

const events: RoutedEvent[] = [
  {
    source: "github",
    where: "acme/webapp #42",
    author: "alice",
    text: "@claude can you take this one?",
    match: "mention → coder in dev, branch issue-42",
  },
  {
    source: "slack",
    where: "#ops",
    author: "dan",
    text: "@claude why did last night's deploy fail?",
    match: "slack → coder in dev",
  },
  {
    source: "github",
    where: "acme/webapp #44",
    author: "eve",
    text: "@claude rewrite the billing module",
    reason: "eve isn't a collaborator",
  },
  {
    source: "github",
    where: "acme/api #17",
    author: "bob",
    text: "Thanks, merged.",
    reason: "no trigger matches",
  },
];

const routingDurations = [700, ...events.flatMap(() => [900, 700]), 3600];

// The router's view of incoming events. Each event arrives, and then shows
// the trigger it matched, or why no agent runs.
export function Routing() {
  const [ref, step] = useSteps(routingDurations);
  return (
    <div ref={ref} className="w-full">
      <Panel
        title={<span>router · acme-agents</span>}
        status={<Live>listening</Live>}
        footer="GitHub App · Slack app"
        action={{ label: "Open trigger", keys: ["↵"] }}
      >
        <ul>
          {events.map((event, index) => {
            const arrived = step > index * 2;
            const resolved = step > index * 2 + 1;
            return (
              <li
                key={event.where}
                className={`grid grid-cols-[16px_1fr] gap-x-3 px-4 py-3 border-b border-rule last:border-b-0 ${shown(arrived)}`}
              >
                <span className="mt-0.5">
                  <Source kind={event.source} />
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-ink-3 truncate">
                    {event.where} · {event.author}
                  </p>
                  <p className="mt-0.5 text-[14px] truncate">{event.text}</p>
                  <p className="mt-2 h-5 font-mono text-[11px]">
                    {!resolved ? (
                      <span className="text-ink-3">matching triggers…</span>
                    ) : event.match ? (
                      <span className="inline-flex h-5 items-center rounded bg-accent/15 px-1.5 text-accent-ink">
                        {event.match}
                      </span>
                    ) : (
                      <span className="inline-flex h-5 items-center rounded bg-ink/[0.06] px-1.5 text-ink-3">
                        ignored · {event.reason}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}

type Conversation = {
  source: "github" | "slack";
  id: string;
  title: string;
  branch: string;
  worktree: string;
  status: string;
  resume: string;
};

const conversations: Conversation[] = [
  {
    source: "github",
    id: "#42",
    title: "Checkout total ignores discount codes",
    branch: "issue-42",
    worktree: "/data/worktrees/issue-42",
    status: "Running · 1 queued",
    resume: "lightbox container resume 42",
  },
  {
    source: "github",
    id: "#43",
    title: "Login test fails on CI",
    branch: "issue-43",
    worktree: "/data/worktrees/issue-43",
    status: "Idle",
    resume: "lightbox container resume 43",
  },
  {
    source: "slack",
    id: "#ops",
    title: "Why did last night's deploy fail?",
    branch: "None, detached at main",
    worktree: "Scratch worktree for the thread",
    status: "Idle",
    resume: "lightbox container resume",
  },
];

const worktreeDurations = conversations.map(() => 3000);

// The worktrees in one container, as a list of conversations with the
// details of the selected one beside it. The selection moves down the list
// by itself, and a click selects a conversation.
export function Worktrees() {
  const [ref, step] = useSteps(worktreeDurations, 0);
  const [picked, setPicked] = useState<number>();
  const selected = conversations[picked ?? step];
  return (
    <div ref={ref} className="w-full">
      <Panel
        title={<span>dev · acme/webapp</span>}
        status={<span className="font-mono text-[11px] text-ink-3">3 worktrees</span>}
        footer={selected.resume}
        action={{ label: "Resume", keys: ["↵"] }}
      >
        <div className="grid sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <ul className="p-2 sm:border-r border-b sm:border-b-0 border-rule">
            {conversations.map((conversation, index) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => setPicked(index)}
                  className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${conversation === selected ? "bg-ink/[0.08]" : "hover:bg-ink/[0.04]"}`}
                >
                  <Source kind={conversation.source} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[11px] text-ink-3">{conversation.id}</span>
                    <span className="block text-[13.5px] truncate">{conversation.title}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <dl key={selected.id} className="lightbox-arrive px-4 py-3 text-[13px]">
            <p className="pb-2 text-xs font-medium text-ink-3">Information</p>
            {[
              ["Branch", selected.branch],
              ["Worktree", selected.worktree],
              ["Session", "coder, resumed by the next message"],
              ["Status", selected.status],
            ].map(([term, value]) => (
              <div
                key={term}
                className="flex justify-between gap-4 py-2 border-t border-rule first-of-type:border-t-0"
              >
                <dt className="shrink-0 text-ink-3">{term}</dt>
                <dd
                  className={`min-w-0 text-right truncate ${term === "Branch" || term === "Worktree" ? "font-mono text-[12px]" : ""} ${term === "Status" && value.startsWith("Running") ? "text-accent-ink" : ""}`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Panel>
    </div>
  );
}

const providerNames = ["cloudflare", "railway"] as const;

const providerRows: [string, string, string][] = [
  ["Router and deployer", "Worker", "Railway service"],
  ["Container dev", "Durable Object container", "Railway service"],
  ["/data disk", "Snapshots and an R2 archive", "Persistent volume"],
  ["Vault", "Secrets Store", "Sealed variables"],
  ["SSH", "wrangler containers ssh", "railway ssh"],
];

const providerDurations = [3400, 3400];

// The same hub on two providers. The plugin name in lightbox.infra.ts
// switches between them, the parts of the hub change with it, and the
// repo's config stays the same.
export function Providers() {
  const [ref, step] = useSteps(providerDurations, 0);
  const provider = providerNames[step];
  return (
    <div ref={ref} className="w-full">
      <Panel
        title={<span>acme/infra · lightbox.infra.ts</span>}
        status={
          <span className="flex rounded-full bg-ink/[0.06] p-0.5 font-mono text-[11px]">
            {providerNames.map((name) => (
              <span
                key={name}
                className={`rounded-full px-2.5 py-0.5 transition-colors ${name === provider ? "bg-ink/[0.12] text-ink" : "text-ink-3"}`}
              >
                {name}
              </span>
            ))}
          </span>
        }
        footer="lightbox infra up"
        action={{ label: "Deploy", keys: ["⌘", "↵"] }}
      >
        <pre className="px-4 py-3 border-b border-rule font-mono text-[12.5px] leading-[1.8] overflow-hidden">
          <code>
            {"new "}
            <span key={provider} className="lightbox-arrive inline-block text-accent-ink">
              {provider}
            </span>
            {'.Router("router", …)\nnew '}
            <span key={`${provider}-2`} className="lightbox-arrive inline-block text-accent-ink">
              {provider}
            </span>
            {'.Deployer("deployer", …)'}
          </code>
        </pre>
        <dl className="px-4 py-1.5 text-[13px]">
          {providerRows.map(([part, cloudflare, railway]) => (
            <div key={part} className="flex justify-between gap-4 py-2 border-b border-rule">
              <dt className="shrink-0 text-ink-3">{part}</dt>
              <dd key={provider} className="lightbox-arrive min-w-0 truncate text-right">
                {provider === "cloudflare" ? cloudflare : railway}
              </dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 py-2">
            <dt className="shrink-0 font-mono text-[12px] text-ink-3">acme/webapp/.lightbox/config.ts</dt>
            <dd className="text-accent-ink">Unchanged</dd>
          </div>
        </dl>
      </Panel>
    </div>
  );
}

type Outpost = { repo: string; containers: string; age: string };

const outposts: Outpost[] = [
  { repo: "acme/api", containers: "dev", age: "2h ago" },
  { repo: "acme/webapp", containers: "dev, linux", age: "5m ago" },
];

const newOutpost: Outpost = { repo: "acme/docs", containers: "dev", age: "just now" };

const hubDurations = [1800, 1600, 2200, 4200];

// The hub and its outposts as `lightbox infra status` would list them. A
// new repo joins: the App is installed, its container builds, and it
// deploys next to the others.
export function HubStatus() {
  const [ref, step] = useSteps(hubDurations);
  const joining = ["", "installing", "building", "deployed"][step];
  const rows = joining ? [...outposts, newOutpost] : outposts;
  return (
    <div ref={ref} className="w-full">
      <Panel
        title={<span>lightbox infra status</span>}
        status={<Live>acme-agents</Live>}
        footer="Failed deliveries: 0"
        action={{ label: "Replay", keys: ["⌘", "R"] }}
      >
        <div className="px-4 pt-3 pb-3 border-b border-rule">
          <p className="text-xs text-ink-3">Hub, shared by every repo</p>
          <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px]">
            {["router", "deployer", "vault", "GitHub App", "Slack app", "claude account"].map(
              (part) => (
                <span key={part} className="rounded bg-ink/[0.06] px-1.5 py-0.5 text-ink-2">
                  {part}
                </span>
              ),
            )}
          </div>
        </div>
        <ul className="px-4 py-2 font-mono text-[12.5px]">
          {[...outposts, newOutpost].map((outpost, index) => {
            const last = index === outposts.length;
            const state = last ? joining : "deployed";
            return (
              <li
                key={outpost.repo}
                className={`grid grid-cols-[1.2rem_minmax(0,1fr)_auto] items-center gap-x-2 py-2 ${shown(rows.includes(outpost))}`}
              >
                <span className="text-ink-3">{last ? "└" : "├"}</span>
                <span className="truncate">
                  {outpost.repo}
                  <span className="text-ink-3"> · {outpost.containers}</span>
                </span>
                <span
                  className={`flex items-center gap-1.5 text-[11px] ${state === "deployed" ? "text-ink-2" : "text-ink-3"}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${state === "deployed" ? "bg-accent" : "border border-ink-3 lightbox-pulse"}`}
                  />
                  {state === "deployed" ? `deployed ${outpost.age}` : `${state}…`}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
