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

// A window with a title bar.
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="w-full rounded-xl bg-term text-ink shadow-window overflow-hidden">
      <div className="h-11 px-4 flex items-center border-b border-rule font-mono text-xs text-ink-2">
        <span className="truncate">{title}</span>
      </div>
      {children}
    </div>
  );
}

const shown = (visible: boolean) =>
  `transition-[opacity,translate] duration-500 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"}`;

const heroLog = [
  "Checked out issue-42",
  "Edited cart/total.ts",
  "Ran the tests: 14 passed",
  "Pushed to issue-42",
];

const heroDurations = [1600, 1300, 900, 900, 1000, 1200, 4200];

// The whole loop in one picture. A comment on an issue wakes a container,
// the agent's steps appear in the container one by one, and its reply goes
// back to the issue.
export function Dispatch() {
  const [ref, step] = useSteps(heroDurations);
  const awake = step >= 1;
  const lines = Math.max(0, step - 1);
  const replied = step >= 5;
  return (
    <div ref={ref} className="w-full flex flex-col text-ink">
      <Thread
        author="alice"
        avatar="bg-[#8b5cf6]"
        text={
          <>
            <b className="font-semibold">@claude</b> can you take this one?
          </>
        }
      />
      <Wire lit={awake} />
      <div
        className={`rounded-xl border border-transparent overflow-hidden transition-shadow duration-700 [background:linear-gradient(var(--color-term),var(--color-term))_padding-box,linear-gradient(140deg,#ffc078,#fe5537_40%,#5c1004)_border-box] ${awake ? "shadow-[0_0_48px_-8px_rgb(254_85_55/0.55)]" : "shadow-window"}`}
      >
        <div className="h-10 px-4 flex items-center border-b border-rule font-mono text-xs text-ink-2">
          container
        </div>
        <ol className="px-4 py-3 font-mono text-[12.5px] leading-[1.9]">
          {heroLog.map((line, index) => (
            <li key={line} className={`flex gap-2 ${shown(index < lines)}`}>
              <span className="text-accent-ink">›</span>
              <span className="min-w-0 truncate">{line}</span>
            </li>
          ))}
        </ol>
      </div>
      <Wire lit={replied} />
      <div className={shown(replied)}>
        <Thread
          author="claude"
          avatar="bg-accent"
          text="Discount codes now apply before tax. I opened #43."
        />
      </div>
    </div>
  );
}

function Thread({ author, avatar, text }: { author: string; avatar: string; text: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl bg-term px-4 py-3 shadow-window">
      <span className={`mt-0.5 w-7 h-7 shrink-0 rounded-full ${avatar}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{author}</p>
        <p className="mt-1 text-[14px] leading-snug">{text}</p>
      </div>
    </div>
  );
}

// A short vertical line between two cards. It turns to the accent colour
// when something has passed along it.
function Wire({ lit }: { lit: boolean }) {
  return (
    <span
      className={`block w-px h-8 ml-[29px] transition-colors duration-500 ${lit ? "bg-accent shadow-[0_0_8px_#fe5537]" : "bg-rule"}`}
    />
  );
}

type RoutedEvent = {
  source: "github" | "slack";
  author: string;
  text: string;
  result: string;
  matched: boolean;
};

const events: RoutedEvent[] = [
  {
    source: "github",
    author: "alice",
    text: "@claude can you take this one?",
    result: "Runs coder",
    matched: true,
  },
  {
    source: "slack",
    author: "dan",
    text: "@claude why did last night's deploy fail?",
    result: "Runs coder",
    matched: true,
  },
  {
    source: "github",
    author: "eve",
    text: "@claude rewrite the billing module",
    result: "Ignored: not a collaborator",
    matched: false,
  },
];

const routingDurations = [700, ...events.flatMap(() => [900, 700]), 3600];

// Incoming messages from GitHub and Slack. Each one arrives, and then shows
// whether an agent runs.
export function Routing() {
  const [ref, step] = useSteps(routingDurations);
  return (
    <div ref={ref} className="w-full">
      <Panel title="router">
        <ul>
          {events.map((event, index) => {
            const arrived = step > index * 2;
            const resolved = step > index * 2 + 1;
            return (
              <li
                key={event.text}
                className={`flex items-start gap-3 px-4 py-3.5 border-b border-rule last:border-b-0 ${shown(arrived)}`}
              >
                <span className="mt-0.5">
                  <Source kind={event.source} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{event.author}</p>
                  <p className="mt-0.5 text-[14px] truncate">{event.text}</p>
                </div>
                <span
                  className={`mt-0.5 shrink-0 text-xs transition-opacity duration-300 ${resolved ? "opacity-100" : "opacity-0"} ${event.matched ? "text-accent-ink" : "text-ink-3"}`}
                >
                  {event.result}
                </span>
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
  title: string;
  branch: string;
};

const conversations: Conversation[] = [
  { source: "github", title: "#42 Checkout total ignores discount codes", branch: "issue-42" },
  { source: "github", title: "#43 Login test fails on CI", branch: "issue-43" },
  { source: "github", title: "#44 Dark mode for settings", branch: "issue-44" },
];

const worktreeDurations = [1200, 700, 700, 700, 3600];

// Conversations on the left, each joined to its own branch on the right.
// The joins appear one at a time.
export function Worktrees() {
  const [ref, step] = useSteps(worktreeDurations);
  return (
    <div ref={ref} className="w-full">
      <Panel title="container">
        <ul className="px-4 py-2">
          {conversations.map((conversation, index) => (
            <li
              key={conversation.branch}
              className="grid grid-cols-[minmax(0,1fr)_2.5rem_auto] items-center gap-2 py-2.5 border-b border-rule last:border-b-0"
            >
              <span className="flex min-w-0 items-center gap-2.5 text-[13.5px]">
                <Source kind={conversation.source} />
                <span className="truncate">{conversation.title}</span>
              </span>
              <span
                className={`h-px transition-colors duration-500 ${index < step ? "bg-accent" : "bg-rule"}`}
              />
              <span
                className={`font-mono text-[12px] transition-colors duration-500 ${index < step ? "text-ink" : "text-ink-3"}`}
              >
                {conversation.branch}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

const providerNames = ["cloudflare", "railway"] as const;

const providerDurations = [3400, 3400];

// The plugin name in lightbox.infra.ts switches between two providers, and
// the repo's config stays the same.
export function Providers() {
  const [ref, step] = useSteps(providerDurations, 0);
  const provider = providerNames[step];
  return (
    <div ref={ref} className="w-full flex flex-col gap-4">
      <Panel title="lightbox.infra.ts">
        <pre className="px-4 py-3 font-mono text-[12.5px] leading-[1.8] overflow-hidden">
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
      </Panel>
      <Panel title=".lightbox/config.ts">
        <pre className="px-4 py-3 font-mono text-[12.5px] leading-[1.8] text-ink-2 overflow-hidden">
          <code>{'new Container("dev", { image: "./Dockerfile" })'}</code>
        </pre>
      </Panel>
    </div>
  );
}

const repos = ["acme/api", "acme/webapp", "acme/docs"];

const hubDurations = [1400, 900, 900, 900, 3600];

// One hub with a line to each repo's outpost. The repos join one at a time.
export function HubStatus() {
  const [ref, step] = useSteps(hubDurations);
  return (
    <div ref={ref} className="w-full">
      <Panel title="hub">
        <ul className="px-4 py-3 font-mono text-[13px]">
          {repos.map((repo, index) => (
            <li
              key={repo}
              className={`grid grid-cols-[1.2rem_minmax(0,1fr)] items-center gap-x-2 py-2 ${shown(index < step)}`}
            >
              <span className="text-ink-3">{index === repos.length - 1 ? "└" : "├"}</span>
              <span className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                {repo}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
