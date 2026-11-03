import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@notation/docs/ui";
import { ArrowRight, BookOpen, Check, Copy, GitHub } from "@notation/docs/ui/icon";
import { Flow } from "#/views/flow";
import { Dispatch, HubStatus, Providers, Routing, TriggerRule, Worktrees } from "#/views/scenes";
import { TypedTerminal } from "#/views/terminal";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "lightbox – Coding agents in remote containers" },
      {
        name: "description",
        content:
          "lightbox runs coding agents in remote containers and connects them to GitHub and Slack.",
      },
    ],
  }),
  component: LandingPage,
});

const github = "https://github.com/notationlabs/lightbox";
const install = "npm install -g @lightbox/cli";

const frame = "page-wrap";
const lead = "text-[18px] md:text-[20px] leading-[1.6] text-ink-2";
const heading = "text-[1.75rem] md:text-[2.25rem] font-semibold tracking-[-0.03em] leading-tight";
const hero = "inline-flex items-center gap-3 rounded-xl px-6 py-3.5 text-[17px] font-medium transition-colors cursor-pointer";
const button =
  "inline-flex items-center gap-2.5 rounded-lg px-5 py-3 text-[16px] font-medium transition-colors cursor-pointer";

function LandingPage() {
  return (
    // Narrows the header and the page content to the same width.
    <div className="flex flex-col min-h-screen bg-surface text-ink font-sans [--page-max-width:1240px]">
      <SiteHeader />
      <main className="flex-1 pb-24">
        <Hero />
        <HowItWorks />
        <Features />
        <Install />
      </main>
      <Footer />
    </div>
  );
}

function Hero() {
  return (
    <section className={`${frame} pt-20 md:pt-28 pb-8`}>
      <Row
        text={
          <>
            <h1 className="text-[2.5rem] md:text-[3.75rem] font-extrabold tracking-[-0.04em] leading-[1.05] text-balance">
              Ask in a thread. Run in a lightbox.
            </h1>
            <p className={`${lead} mt-6`}>
              lightbox is a hub, a CLI and a set of packages that run coding agents in remote containers on your
              cloud.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <DocLink slug="manual/quickstart" className={`${hero} bg-ink text-surface hover:bg-ink/85`}>
                Quick start
              </DocLink>
              <DocLink slug="manual/introduction" className={`${hero} bg-card text-ink hover:bg-rule`}>
                <BookOpen className="w-[18px] h-[18px]" /> Documentation
              </DocLink>
            </div>
            <CopyButton
              text={install}
              className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-rule bg-surface px-5 py-3.5 text-left font-mono text-[15px] text-ink-2 hover:border-ink-3 transition-colors cursor-pointer"
            >
              <span>
                <span className="select-none text-ink-3">$ </span>
                {install}
              </span>
            </CopyButton>
          </>
        }
        art={
          <Picture>
            <Dispatch />
          </Picture>
        }
      />
    </section>
  );
}

function HowItWorks() {
  return (
    <section className={`${frame} pt-20 md:pt-28`}>
      <h2 className={heading}>From a thread to a container</h2>
      <p className={`${lead} mt-3 max-w-3xl`}>
        The hub receives events from GitHub and Slack. It routes each one to an agent in a container, and the agent
        replies in the same thread.
      </p>
      <div className="mt-12">
        <Flow />
      </div>
    </section>
  );
}

// Two columns, the text narrower than the art.
function Row({ text, art }: { text: ReactNode; art: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-8 lg:gap-20">
      <div>{text}</div>
      <div className="self-center min-w-0">{art}</div>
    </div>
  );
}

// The scenes are drawn with the dark tokens, so they read as dark code panels
// on the light page.
function Picture({ children }: { children: ReactNode }) {
  return <div className="dark w-full max-w-[36rem] mx-auto text-ink">{children}</div>;
}

type Feature = {
  id: string;
  title: string;
  text: string;
  doc: string;
  link: string;
  panel: ReactNode;
};

const features: Feature[] = [
  {
    id: "channels",
    title: "Listens on your channels",
    text: "The hub receives issues, issue comments and Slack mentions, and routes each one to a trigger in the repo's outpost. Triggers can filter by label, mention and author, so only people you trust can start a run.",
    doc: "manual/connections",
    link: "Read the manual: Connections",
    panel: <Routing />,
  },
  {
    id: "worktrees",
    title: "One branch per conversation",
    text: "Every issue gets a worktree in the container. When you mention the agent on issue #42, it starts work on the branch issue-42. When you comment on #42 later, it picks up the same Claude session, with the same files.",
    doc: "manual/worktrees",
    link: "Read the manual: Worktrees and sessions",
    panel: <Worktrees />,
  },
  {
    id: "providers",
    title: "Runs on your cloud",
    text: "lightbox deploys the hub and the containers to your Cloudflare or Railway account. The containers are built from a Dockerfile in your repo. Which provider you use is set in one file, and you can change it later.",
    doc: "manual/providers",
    link: "Read the manual: Container providers",
    panel: <Providers />,
  },
  {
    id: "hub",
    title: "One hub for the organisation",
    text: "lightbox deploys the router, the deployer and the vault from your infra repo. All of your repos share them, along with one GitHub App and one Slack bot. Installing the App on a repo makes the deployer create that repo's containers. Only the router and the deployer can read the vault.",
    doc: "manual/infra",
    link: "Read the manual: Declaring infra",
    panel: <HubStatus />,
  },
  {
    id: "triggers",
    title: "Triggers in TypeScript",
    text: "Triggers are declared in TypeScript in the repo's outpost. A trigger has an event selector, such as gh.issueComment(...), the people it accepts events from, an agent and a container. The router matches selectors as data. TypeScript infers the event type from the selector.",
    doc: "manual/outposts",
    link: "Read the manual: Declaring outposts",
    panel: <TriggerRule />,
  },
  {
    id: "resume",
    title: "Pick up where the agent left off",
    text: "Run lightbox container resume 42 and your terminal attaches to the agent's Claude session, in its worktree. The agent still knows what it did. You can give it the next instruction, or edit the branch and push it yourself.",
    doc: "manual/github-usage",
    link: "Read the manual: Using lightbox on GitHub",
    panel: (
      <TypedTerminal
        lines={[
          { prompt: "~/acme/webapp $", text: "lightbox container resume 42" },
          { text: "Attached to coder on branch issue-42", pause: 900 },
          { text: "⏺ Discount codes now apply before tax. I opened #43.", pause: 700 },
          { prompt: ">", text: "Round the total to two decimal places too" },
          { text: "⏺ Done. I pushed the change to #43.", pause: 1800 },
        ]}
      />
    ),
  },
];

function Features() {
  const [active, setActive] = useState(features[0]!.id);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    for (const feature of features) {
      const element = document.getElementById(feature.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);
  return (
    <section className="pt-20 md:pt-28">
      <h2 className={`${frame} ${heading}`}>Agents for the whole organisation</h2>
      <nav className="sticky top-[var(--header-height)] z-20 mt-6 bg-surface border-b border-rule">
        <div className={`${frame} py-3`}>
          <div className="flex flex-wrap gap-6 font-mono text-[14px]">
            {features.map((feature) => (
              <a
                key={feature.id}
                href={`#${feature.id}`}
                className={active === feature.id ? "text-ink" : "text-ink-3 hover:text-ink"}
              >
                {feature.id}
              </a>
            ))}
          </div>
        </div>
      </nav>
      <div className={frame}>
        {features.map((feature) => (
          <article
            key={feature.id}
            id={feature.id}
            className="scroll-mt-[calc(var(--header-height)+5rem)] py-12 md:py-14 border-b border-rule last:border-b-0"
          >
            <Row
              text={
                <>
                  <h3 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink">{feature.title}</h3>
                  <p className="mt-3 text-[16px] leading-[1.7] text-ink-2">{feature.text}</p>
                  <div className="mt-8">
                    <DocLink slug={feature.doc} className={pill}>
                      {feature.link} <ArrowRight className="w-3.5 h-3.5 text-accent-ink" />
                    </DocLink>
                  </div>
                </>
              }
              art={<Picture>{feature.panel}</Picture>}
            />
          </article>
        ))}
      </div>
    </section>
  );
}

function Install() {
  return (
    <section id="install" className={`${frame} pt-20 md:pt-28 scroll-mt-20`}>
      <h2 className={heading}>Install</h2>
      <div className="mt-8 flex flex-wrap gap-3">
        <CopyButton text={install} className={`${button} bg-ink text-surface font-mono text-[15px] hover:bg-ink/85`}>
          {install}
        </CopyButton>
        <DocLink slug="manual/installation" className={`${button} bg-card text-ink hover:bg-rule`}>
          Installation guide
        </DocLink>
        <DocLink slug="manual/quickstart" className={`${button} bg-card text-ink hover:bg-rule`}>
          Quick start
        </DocLink>
      </div>
    </section>
  );
}

function CopyButton({ text, className, children }: { text: string; className: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={className}
    >
      {children}
      <Icon className="w-4 h-4 opacity-60" />
    </button>
  );
}

function Footer() {
  return (
    <footer className="border-t border-rule">
      <div className={`${frame} py-8 flex flex-wrap items-center justify-between gap-4 text-[14px] text-ink-3`}>
        <p>© 2026 Notation Labs Ltd · Scotland SC765604</p>
        <div className="flex items-center gap-6">
          <DocLink slug="manual/introduction" className="hover:text-ink">
            Docs
          </DocLink>
          <a href={github} className="inline-flex items-center gap-2 hover:text-ink">
            <GitHub className="w-4 h-4" /> GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

const pill =
  "inline-flex items-center gap-2 rounded-md bg-card px-3 py-2 text-[14px] text-ink hover:bg-rule transition-colors";

function DocLink({
  slug,
  className,
  children,
}: {
  slug: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to="/docs/$" params={{ _splat: slug }} className={className}>
      {children}
    </Link>
  );
}
