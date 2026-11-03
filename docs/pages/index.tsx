import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@notation/docs/ui";
import { AgentIcon, ContainerIcon, GitHubIcon, SlackIcon, TerminalIcon } from "#/views/icons";
import { Issue } from "#/views/issue";
import { Path } from "#/views/path";
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

// The hero says what lightbox does and shows an agent answering an issue.
// Each section after it makes one claim and shows the code or terminal that
// backs it up.

const link = "font-mono text-[13px] text-link hover:underline underline-offset-4";

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

function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-paper text-ink">
      <SiteHeader />
      <main className="page-wrap flex-1 pt-12 md:pt-20">
        <div className="relative mx-auto max-w-6xl">
          <section className="relative">
            <h1 className="sr-only">lightbox</h1>
            <p className="max-w-4xl text-lg md:text-xl leading-[2.1] text-ink-2">
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
              </Term>
              <br className="hidden md:block" /> in{" "}
              <Term icon={<ContainerIcon />} color="bg-accent">
                containers
              </Term>{" "}
              on your cloud, and hands each session to your{" "}
              <Term icon={<TerminalIcon />} color="bg-[#334155]">
                terminal
              </Term>
              .
            </p>
            <div className="mt-8 md:mt-10 flex flex-wrap gap-3">
              <Link
                to="/docs/$"
                params={{ _splat: "manual/quickstart" }}
                className="inline-flex items-center gap-2.5 rounded-full bg-accent px-6 py-3 text-base font-medium text-on-accent transition-colors hover:bg-ink hover:text-paper"
              >
                <span className="w-[18px] h-[18px]">
                  <TerminalIcon />
                </span>
                Quick start
              </Link>
              <Link
                to="/docs/$"
                params={{ _splat: "manual/introduction" }}
                className="inline-flex items-center rounded-full border border-ink/15 bg-card px-6 py-3 text-base font-medium text-ink transition-colors hover:bg-ink hover:text-paper hover:border-ink"
              >
                Read the manual
              </Link>
            </div>
            <div className="mt-14 md:mt-20">
              <Issue />
            </div>
          </section>

          <Section side title="Events in, agents out.">
            <Path />
          </Section>

          <Section
            title="One hub, and an outpost in each repo."
            fact={
              <>
                <Link to="/docs/$" params={{ _splat: "manual/infra" }} className={link}>
                  Declaring&nbsp;infra&nbsp;→
                </Link>
                <Link to="/docs/$" params={{ _splat: "manual/outposts" }} className={link}>
                  Declaring&nbsp;outposts&nbsp;→
                </Link>
              </>
            }
          >
            <CodeTabs
              files={[
                { name: "lightbox.infra.ts", source: hub },
                { name: ".lightbox/config.ts", source: outpost },
              ]}
            />
          </Section>

          <Section
            side
            title="Pick up where the agent left off."
            fact={
              <Link to="/docs/$" params={{ _splat: "manual/github-usage" }} className={link}>
                Conversations&nbsp;&amp;&nbsp;sessions&nbsp;→
              </Link>
            }
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
          </Section>
        </div>
      </main>
      <Footer />
    </div>
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

// Heading, one line of mono links, then the artifact that backs it up.
function Section({
  title,
  fact,
  side,
  children,
}: {
  title: string;
  fact?: ReactNode;
  side?: boolean;
  children?: ReactNode;
}) {
  return (
    <section
      className={`mt-28 md:mt-40 ${side ? "md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:gap-14 md:items-center" : ""}`}
    >
      <div>
        <h2 className="text-[1.8rem] md:text-[2.3rem] leading-tight font-semibold tracking-[-0.03em] text-balance">
          {title}
        </h2>
        {fact && (
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[13px] text-ink-2">
            {fact}
          </p>
        )}
      </div>
      {children && <div className={side ? "mt-8 md:mt-0" : "mt-8"}>{children}</div>}
    </section>
  );
}

function Footer() {
  return (
    <footer className="page-wrap mt-28">
      <div className="mx-auto max-w-6xl border-t border-rule py-7 flex flex-col gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
        <p>Notation Labs Ltd</p>
        <p className="flex gap-6">
          <Link
            to="/docs/$"
            params={{ _splat: "manual/introduction" }}
            className="hover:text-link transition-colors"
          >
            Manual
          </Link>
          <Link
            to="/docs/$"
            params={{ _splat: "packages/core" }}
            className="hover:text-link transition-colors"
          >
            Packages
          </Link>
          <a
            href="https://github.com/notationlabs/lightbox"
            className="hover:text-link transition-colors"
          >
            GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}
