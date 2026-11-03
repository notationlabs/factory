import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@notation/docs/ui";
import {
  AgentIcon,
  ContainerIcon,
  GitHubIcon,
  HubIcon,
  SlackIcon,
  TerminalIcon,
} from "#/views/icons";
import { Flow } from "#/views/flow";
import { Issue } from "#/views/issue";
import { CodeTabs, TypedTerminal } from "#/views/terminal";

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

const hub = `export default lightbox(() => {
  const vault = new cloudflare.Vault("vault");
  const router = new cloudflare.Router("router", { project: "acme-agents", vault });

  const gh = new github.Connection("gh", { name: "acme-agents", org: "acme", router });
  new github.CodeHost("github", { connection: gh, allow: [{ owner: "acme" }] });

  const claudeAccount = new claude.Account("claude", {
    auth: secret.env("CLAUDE_CODE_OAUTH_TOKEN"),
  });

  new cloudflare.Deployer("deployer", { router, vault, accounts: [claudeAccount] });
});`;

const outpost = `export default outpost(() => {
  const gh = github.Connection.get("acme-agents").channel({ id: "issues" });

  const dev = new Container("dev", {
    image: "./Dockerfile",
    runtimes: [claude.runtime],
    policies: [code],
  });

  new Trigger("mention", {
    event: gh.issueComment({ mention: "@claude", from: github.collaborators() }),
    worktree: (event) => \`issue-\${event.issue.number}\`,
    agent: new claude.Agent("coder", { model: "claude-opus-5-5" }),
    container: dev,
  });
});`;

const integrations = [
  { name: "GitHub", slug: "packages/github" },
  { name: "Slack", slug: "packages/slack" },
  { name: "Claude Code", slug: "packages/claude" },
  { name: "Cloudflare", slug: "packages/cloudflare" },
  { name: "Railway", slug: "packages/railway" },
  { name: "Your terminal", slug: "packages/cli" },
];

const overline = "font-mono text-xs md:text-[13px] uppercase tracking-[0.1em]";

const button =
  "inline-flex h-12 items-center justify-center gap-2 rounded-md border px-5 text-base font-medium transition-colors";

function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-paper text-ink [--page-max-width:76rem]">
      <SiteHeader />
      <main className="page-wrap flex-1 pt-10 md:pt-20 flex flex-col gap-24 md:gap-32">
        <Hero />
        <Integrations />
        <Platform />
        <Panel />
        <Cards />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}

function Hero() {
  return (
    <section className="grid gap-12 xl:grid-cols-2 xl:items-center">
      <div className="flex flex-col items-start">
        <DocLink
          slug="manual/github-usage"
          className={`${overline} inline-flex items-center gap-1.5 rounded-full border border-accent-soft px-5 py-3 transition-colors hover:border-accent`}
        >
          <span className="text-accent-ink">Guide:</span>
          <span className="text-ink-2">Mention @claude on an issue</span>
          <Chevron />
        </DocLink>
        <h1 className="mt-8 text-[2.6rem] md:text-[3.6rem] leading-[1.05] font-semibold tracking-[-0.03em]">
          <span className="text-accent-ink">Coding agents</span>
          <br />
          in remote containers.
        </h1>
        <p className="mt-6 max-w-xl text-lg md:text-xl leading-[1.9] text-ink-2">
          Listens to{" "}
          <Term
            icon={<GitHubIcon />}
            color="bg-[#24292f] dark:ring-1 dark:ring-inset dark:ring-white/20"
          >
            GitHub
          </Term>{" "}
          issues and{" "}
          <Term icon={<SlackIcon />} color="bg-[#611f69]">
            Slack
          </Term>{" "}
          threads, runs{" "}
          <Term icon={<AgentIcon />} color="bg-[#d97757]">
            Claude Code
          </Term>{" "}
          in{" "}
          <Term icon={<ContainerIcon />} color="bg-accent">
            containers
          </Term>{" "}
          on your cloud, and hands each session to your{" "}
          <Term icon={<TerminalIcon />} color="bg-[#334155]">
            terminal
          </Term>
          .
        </p>
        <div className="mt-10 flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
          <DocLink
            slug="manual/quickstart"
            className={`${button} border-transparent bg-accent text-on-accent hover:bg-accent-ink`}
          >
            Quick start <Arrow />
          </DocLink>
          <DocLink
            slug="manual/introduction"
            className={`${button} border-ink/20 bg-card text-ink hover:border-ink/45`}
          >
            Read the manual
          </DocLink>
        </div>
      </div>
      <Issue />
    </section>
  );
}

// A grid of hairlines. Each cell draws its own right and bottom border, and
// the grid is pulled 1px under its clipping box so the outer edges vanish.
function Integrations() {
  return (
    <section>
      <p className={`${overline} text-ink-2`}>Works with</p>
      <div className="mt-4 overflow-hidden">
        <div className="-mr-px -mb-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border-t border-rule">
          {integrations.map((item) => (
            <DocLink
              key={item.name}
              slug={item.slug}
              className="flex min-h-24 items-center justify-center border-r border-b border-rule px-4 py-6 text-lg font-semibold tracking-tight text-ink-3 transition-colors hover:text-ink"
            >
              {item.name}
            </DocLink>
          ))}
        </div>
      </div>
    </section>
  );
}

function Platform() {
  return (
    <section>
      <div className="flex flex-col gap-6 xl:flex-row xl:gap-20">
        <h2 className="xl:w-2/5 shrink-0 text-[1.9rem] md:text-[2.4rem] leading-tight font-semibold tracking-[-0.03em] text-balance">
          The <span className="text-accent-ink">agent platform</span> that runs on your own cloud
        </h2>
        <div className="flex-1 text-lg md:text-xl leading-relaxed text-ink-2">
          <p className="font-semibold text-ink">
            lightbox runs coding agents in remote containers and connects them to the places your
            team talks.
          </p>
          <p className="mt-4">
            You stand up one <strong className="font-semibold text-ink">hub</strong> for your
            organisation. Each repo declares an{" "}
            <strong className="font-semibold text-ink">outpost</strong>: the container its agents
            run in, and the events that wake them.
          </p>
          <DocLink slug="manual/introduction" className={`mt-6 ${textLink}`}>
            Read the introduction <Arrow />
          </DocLink>
        </div>
      </div>
      <div className="mt-16 md:mt-24 grid gap-12 md:grid-cols-3 md:gap-16">
        <Feature
          icons={[
            { icon: <GitHubIcon />, color: "bg-[#24292f]" },
            { icon: <SlackIcon />, color: "bg-[#611f69]" },
          ]}
          title="Listens"
          slug="manual/connections"
        >
          Messages on your channels, such as GitHub issues and Slack threads, arrive at the hub.
        </Feature>
        <Feature
          icons={[
            { icon: <HubIcon />, color: "bg-[#334155]" },
            { icon: <ContainerIcon />, color: "bg-accent" },
          ]}
          title="Dispatches"
          slug="manual/providers"
        >
          The hub sends each conversation to an agent in a remote container, on Cloudflare
          Containers, Railway and others.
        </Feature>
        <Feature
          icons={[
            { icon: <AgentIcon />, color: "bg-[#d97757]" },
            { icon: <TerminalIcon />, color: "bg-[#334155]" },
          ]}
          title="Connects"
          slug="manual/worktrees"
        >
          You attach to any agent's session from your terminal, on the branch it was working on.
        </Feature>
      </div>
    </section>
  );
}

function Feature({
  icons,
  title,
  slug,
  children,
}: {
  icons: { icon: ReactNode; color: string }[];
  title: string;
  slug: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex h-36 items-center justify-center gap-3 rounded-xl border border-dashed border-rule">
        {icons.map((item, index) => (
          <span key={index} className="flex items-center gap-3">
            {index > 0 && <span className="w-8 border-t border-dashed border-ink-3" />}
            <span className="rounded-xl border border-rule bg-card p-2.5 shadow-sm">
              <span className={`block w-9 h-9 rounded-lg p-2 text-white ${item.color}`}>
                {item.icon}
              </span>
            </span>
          </span>
        ))}
      </div>
      <h3 className="mt-6 text-xl md:text-2xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-base leading-relaxed text-ink-2">{children}</p>
      <DocLink slug={slug} className={`mt-4 ${textLink}`}>
        Learn more <Arrow />
      </DocLink>
    </div>
  );
}

function Panel() {
  return (
    <section className="rounded-2xl bg-accent/[0.06] dark:bg-accent/[0.08] px-5 py-10 sm:px-10 md:px-14 md:py-14">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-12">
        <div className="max-w-2xl">
          <p className={`${overline} text-accent-ink`}>Agents & triggers</p>
          <h2 className="mt-3 text-[1.9rem] md:text-[2.4rem] leading-tight font-semibold tracking-[-0.03em]">
            Events in, agents out.
          </h2>
          <p className="mt-3 text-lg leading-relaxed text-ink-2">
            Each conversation gets its own agent and its own branch. The reply goes back to the
            thread it came from.
          </p>
        </div>
        <DocLink slug="manual/agents-and-triggers" className={`shrink-0 ${textLink}`}>
          Learn more about triggers <Arrow />
        </DocLink>
      </div>
      <div className="mt-10">
        <Flow />
      </div>
    </section>
  );
}

function Cards() {
  return (
    <section className="flex flex-col gap-8">
      <Card
        title="One hub, and an outpost in each repo"
        links={[
          { label: "Learn more about the hub", slug: "manual/infra" },
          { label: "Learn more about outposts", slug: "manual/outposts" },
        ]}
        description="The hub declares the connections, the vault and the deployer once for your organisation. Each repo's outpost declares its container and the triggers that start agents in it. Both are TypeScript."
      >
        <CodeTabs
          files={[
            { name: "lightbox.infra.ts", source: hub },
            { name: ".lightbox/config.ts", source: outpost },
          ]}
        />
      </Card>
      <Card
        side
        title="Pick up where the agent left off"
        links={[{ label: "Learn more about sessions", slug: "manual/github-usage" }]}
        description="Every conversation has a container and a branch. Resume it from your terminal to read the agent's work, continue its Claude session, or push a fix yourself."
      >
        <TypedTerminal
          lines={[
            { prompt: "~/acme/webapp", text: "lightbox container resume 42" },
            {
              text: "Connected to dev · branch issue-42 · resuming Claude session",
              pause: 900,
            },
            { prompt: "~/acme/webapp", text: "git log --oneline -1" },
            { text: "3f9c2e1 Apply discount codes before tax" },
          ]}
        />
      </Card>
    </section>
  );
}

function Card({
  title,
  description,
  links,
  side,
  children,
}: {
  title: string;
  description: string;
  links: { label: string; slug: string }[];
  side?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-rule bg-card p-6 sm:p-8 md:p-10 ${side ? "lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14 lg:items-center" : ""}`}
    >
      <div className={side ? "" : "md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-14"}>
        <h2 className="text-2xl md:text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-balance">
          {title}
        </h2>
        <div className={side ? "mt-3" : "mt-3 md:mt-0"}>
          <p className="text-base md:text-lg leading-relaxed text-ink-2">{description}</p>
          <p className="mt-5 flex flex-wrap gap-x-8 gap-y-2">
            {links.map((item) => (
              <DocLink key={item.slug} slug={item.slug} className={textLink}>
                {item.label} <Arrow />
              </DocLink>
            ))}
          </p>
        </div>
      </div>
      <div className={side ? "mt-8 lg:mt-0" : "mt-8 md:mt-10"}>{children}</div>
    </div>
  );
}

function Closing() {
  return (
    <section className="flex flex-col items-start gap-8 border-t border-rule pt-16 md:flex-row md:items-center md:justify-between md:pt-20">
      <div>
        <p className={`${overline} text-ink-2`}>Get started</p>
        <h2 className="mt-3 text-[1.9rem] md:text-[2.4rem] leading-tight font-semibold tracking-[-0.03em]">
          Put an agent on your next issue.
        </h2>
      </div>
      <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
        <DocLink
          slug="manual/quickstart"
          className={`${button} border-transparent bg-accent text-on-accent hover:bg-accent-ink`}
        >
          Quick start <Arrow />
        </DocLink>
        <a
          href="https://github.com/notationlabs/lightbox"
          className={`${button} border-ink/20 bg-card text-ink hover:border-ink/45`}
        >
          <GitHubIcon className="w-4 h-4" />
          View on GitHub
        </a>
      </div>
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
    <footer className="mt-28 md:mt-36 border-t border-rule bg-ink/[0.02]">
      <div className="page-wrap grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        {footerColumns.map((column) => (
          <div key={column.heading}>
            <p className={`${overline} text-ink-3`}>{column.heading}</p>
            <ul className="mt-4 flex flex-col gap-2.5 text-[15px] text-ink-2">
              {column.links.map((item) => (
                <li key={item.slug}>
                  <DocLink slug={item.slug} className="hover:text-ink transition-colors">
                    {item.label}
                  </DocLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <p className={`${overline} text-ink-3`}>Project</p>
          <ul className="mt-4 flex flex-col gap-2.5 text-[15px] text-ink-2">
            <li>
              <a
                href="https://github.com/notationlabs/lightbox"
                className="hover:text-ink transition-colors"
              >
                GitHub
              </a>
            </li>
            <li>Notation Labs Ltd</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

const textLink =
  "inline-flex items-center gap-1.5 font-semibold text-accent-ink decoration-accent-soft underline-offset-[5px] hover:underline";

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

// A noun in the value proposition, led by its icon on a block of colour.
// The tile clips its overflow so its baseline is its bottom edge, which the
// offset then centres on the capitals.
function Term({ icon, color, children }: { icon: ReactNode; color: string; children: ReactNode }) {
  return (
    <span className="whitespace-nowrap text-ink font-medium">
      <span
        className={`inline-block overflow-hidden w-[1.3em] h-[1.3em] p-[0.2em] ml-[0.15em] mr-[0.3em] rounded-[0.32em] align-[-0.3em] text-white ${color}`}
      >
        {icon}
      </span>
      {children}
    </span>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="m6 3.5 4.5 4.5L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
