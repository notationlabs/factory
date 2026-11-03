import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@notation/docs/ui";
import { AgentIcon, ContainerIcon, GitHubIcon, HubIcon, TerminalIcon } from "#/views/icons";
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

const overline = "font-mono text-xs uppercase tracking-[0.14em]";

function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen [--page-max-width:1240px]">
      <div className="dark bg-paper text-ink border-b border-rule">
        <SiteHeader />
      </div>
      <main className="flex-1">
        <Frame dark>
          <Hero />
        </Frame>
        <Frame dark>
          <Agents />
        </Frame>
        <Frame>
          <Outposts />
        </Frame>
        <Frame dark>
          <Closing />
        </Frame>
      </main>
      <Footer />
    </div>
  );
}

// A band of the page with a hairline below it, as wide as the header's content.
function Frame({ dark, children }: { dark?: boolean; children: ReactNode }) {
  return (
    <div className={`${dark ? "dark" : ""} bg-paper text-ink`}>
      <div className="page-wrap">
        <div className="border-b border-rule">{children}</div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2">
      <div className="flex flex-col justify-center py-16 md:py-28 lg:pr-12">
        <h1 className="text-[2.9rem] sm:text-[4rem] leading-[1.02] font-medium tracking-[-0.045em]">
          Ask in a thread.
          <br />
          Run in a lightbox.
        </h1>
        <p className="mt-7 max-w-md text-lg md:text-xl leading-relaxed text-ink-2">
          lightbox is a hub, a CLI and a set of packages that run coding agents in remote containers
          on your cloud.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <DocLink slug="manual/quickstart" className={primaryButton}>
            Quick start
          </DocLink>
          <a href="https://github.com/notationlabs/lightbox" className={secondaryButton}>
            View on GitHub
          </a>
          <DocLink slug="manual/introduction" className={secondaryButton}>
            Read the manual
          </DocLink>
        </div>
      </div>
      <div className="flex items-center justify-end pb-16 lg:py-16 lg:pl-12">
        <div className="w-full lg:max-w-[460px]">
          <Dispatch />
        </div>
      </div>
    </section>
  );
}

function Agents() {
  return (
    <section>
      <div className="py-16 md:py-24 border-b border-rule">
        <Flow />
      </div>
      <Row
        text={
          <Feature
            icon={<HubIcon />}
            title="Listens on your channels"
            description="The hub receives issues, issue comments and Slack mentions, and routes each one to a trigger in the repo's outpost. Triggers can filter by label, mention and author, so only people you trust can start a run."
            link={{ label: "Connect a channel", slug: "manual/connections" }}
          />
        }
        art={
          <Picture>
            <Routing />
          </Picture>
        }
      />
      <Row
        flip
        text={
          <Feature
            icon={<AgentIcon />}
            title="One branch per conversation"
            description="Every issue gets a worktree in the container. When you mention the agent on issue #42, it starts work on the branch issue-42. When you comment on #42 later, it picks up the same Claude session, with the same files."
            link={{ label: "Worktrees and sessions", slug: "manual/worktrees" }}
          />
        }
        art={
          <Picture>
            <Worktrees />
          </Picture>
        }
      />
      <Row
        last
        text={
          <Feature
            icon={<ContainerIcon />}
            title="Runs on your cloud"
            description="lightbox deploys the hub and the containers to your Cloudflare or Railway account. The containers are built from a Dockerfile in your repo. Which provider you use is set in one file, and you can change it later."
            link={{ label: "Container providers", slug: "manual/providers" }}
          />
        }
        art={
          <Picture>
            <Providers />
          </Picture>
        }
      />
    </section>
  );
}

function Outposts() {
  return (
    <section>
      <Row
        text={
          <Feature
            icon={<HubIcon />}
            title="One hub for the organisation"
            description="lightbox deploys the router, the deployer and the vault from your infra repo. All of your repos share them, along with one GitHub App and one Slack bot. Installing the App on a repo makes the deployer create that repo's containers. Only the router and the deployer can read the vault."
            link={{ label: "Declaring infra", slug: "manual/infra" }}
          />
        }
        art={
          <Picture>
            <HubStatus />
          </Picture>
        }
      />
      <Row
        flip
        text={
          <Feature
            icon={<GitHubIcon />}
            title="Triggers in TypeScript"
            description="Triggers are declared in TypeScript in the repo's outpost. A trigger has an event selector, such as gh.issueComment(...), the people it accepts events from, an agent and a container. The router matches selectors as data. TypeScript infers the event type from the selector."
            link={{ label: "Declaring outposts", slug: "manual/outposts" }}
          />
        }
        art={
          <Picture>
            <TriggerRule />
          </Picture>
        }
      />
      <Row
        last
        text={
          <Feature
            icon={<TerminalIcon />}
            title="Pick up where the agent left off"
            description="Run lightbox container resume 42 and your terminal attaches to the agent's Claude session, in its worktree. The agent still knows what it did. You can give it the next instruction, or edit the branch and push it yourself."
            link={{ label: "Using lightbox on GitHub", slug: "manual/github-usage" }}
          />
        }
        art={
          <Picture>
            <TypedTerminal
            lines={[
              { prompt: "~/acme/webapp $", text: "lightbox container resume 42" },
              { text: "Attached to coder on branch issue-42", pause: 900 },
              {
                text: "⏺ Discount codes now apply before tax. I opened #43.",
                pause: 700,
              },
              { prompt: ">", text: "Round the total to two decimal places too" },
              { text: "⏺ Done. I pushed the change to #43.", pause: 1800 },
            ]}
          />
          </Picture>
        }
      />
    </section>
  );
}

// Two cells side by side, split by a hairline. `flip` puts the art first.
function Row({
  text,
  art,
  flip,
  last,
}: {
  text: ReactNode;
  art: ReactNode;
  flip?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 ${last ? "" : "border-b border-rule"}`}>
      <div className={flip ? "md:order-2 md:pl-12" : "md:pr-12"}>{text}</div>
      <div className={`${flip ? "md:order-1 md:pr-12" : "md:pl-12"} min-w-0 border-t md:border-t-0 border-rule`}>{art}</div>
    </div>
  );
}

// A cell for an illustration.
function Picture({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-80 items-center justify-center py-12">
      {children}
    </div>
  );
}

function Feature({
  icon,
  title,
  description,
  link,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  link: { label: string; slug: string };
}) {
  return (
    <div className="flex h-full flex-col py-12 md:min-h-[30rem]">
      <span className="block w-5 h-5 text-accent-ink">{icon}</span>
      <h3 className="mt-5 text-[1.75rem] md:text-[2rem] leading-tight font-medium tracking-[-0.03em]">
        {title}
      </h3>
      <p className="mt-4 max-w-md text-lg leading-relaxed text-ink-2">{description}</p>
      <div className="mt-auto pt-10">
        <DocLink slug={link.slug} className={pill}>
          {link.label} <NorthEast />
        </DocLink>
      </div>
    </div>
  );
}

function Closing() {
  return (
    <section className="flex flex-col items-center py-24 md:py-32 text-center">
        <h2 className="text-[2.2rem] md:text-[3.2rem] leading-[1.05] font-medium tracking-[-0.04em]">
          Ask in a thread. Run in a lightbox.
        </h2>
        <p className="mt-5 max-w-md text-lg md:text-xl leading-relaxed text-ink-2">
          Channels, containers and agents, declared in TypeScript and deployed to your cloud.
        </p>
        <DocLink slug="manual/quickstart" className={`mt-9 ${primaryButton}`}>
          Quick start
        </DocLink>
    </section>
  );
}

const footerColumns = [
  {
    heading: "Manual",
    links: [
      { label: "Introduction", slug: "manual/introduction" },
      { label: "Installation", slug: "manual/installation" },
      { label: "Quick start", slug: "manual/quickstart" },
      { label: "CLI reference", slug: "manual/cli" },
    ],
  },
  {
    heading: "Concepts",
    links: [
      { label: "Declaring infra", slug: "manual/infra" },
      { label: "Declaring outposts", slug: "manual/outposts" },
      { label: "Agents & triggers", slug: "manual/agents-and-triggers" },
      { label: "Secrets & vaults", slug: "manual/secrets" },
    ],
  },
  {
    heading: "Packages",
    links: [
      { label: "lightbox", slug: "packages/core" },
      { label: "@lightbox/github", slug: "packages/github" },
      { label: "@lightbox/slack", slug: "packages/slack" },
      { label: "@lightbox/cloudflare", slug: "packages/cloudflare" },
    ],
  },
];

function Footer() {
  return (
    <footer className="dark bg-paper text-ink">
      <div className="page-wrap">
        <div className="grid gap-10 py-16 sm:grid-cols-2 lg:grid-cols-4">
          {footerColumns.map((column) => (
            <div key={column.heading}>
              <p className={`${overline} text-ink-3`}>{column.heading}</p>
              <ul className="mt-5 flex flex-col gap-3 text-[16px]">
                {column.links.map((item) => (
                  <li key={item.slug}>
                    <DocLink slug={item.slug} className="hover:text-accent-ink transition-colors">
                      {item.label}
                    </DocLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <p className={`${overline} text-ink-3`}>Project</p>
            <ul className="mt-5 flex flex-col gap-3 text-[16px]">
              <li>
                <a
                  href="https://github.com/notationlabs/lightbox"
                  className="inline-flex items-center gap-2 hover:text-accent-ink transition-colors"
                >
                  <GitHubIcon className="w-4 h-4" />
                  GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>
        <p className="border-t border-rule py-6 text-sm text-ink-3">
          © 2026 Notation Labs Ltd.
        </p>
      </div>
    </footer>
  );
}

const button =
  "inline-flex h-11 items-center justify-center rounded-md border px-5 text-base font-medium transition-colors";

const primaryButton = `${button} border-ink bg-ink text-paper hover:bg-ink/85`;

const secondaryButton = `${button} border-ink/20 text-ink hover:border-ink/45`;

const pill =
  "inline-flex items-center gap-2 rounded-md bg-ink/[0.07] px-3 py-1.5 font-mono text-sm tracking-[0.04em] text-ink transition-colors hover:bg-ink/[0.12]";

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


function NorthEast() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M5 11 11 5M6 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
