import type { ReactNode } from "react";
import { ContainerIcon, GitHubIcon, HubIcon } from "#/views/icons";

// An event's route: from the platform to the hub's router as a webhook, then
// from the hub into the outpost's container.
export function Path() {
  return (
    <div className="rounded-2xl bg-card shadow-window px-4 py-9 sm:px-8">
      <div className="flex items-center gap-2 sm:gap-6">
        <Node label="GitHub" sub="issue #42">
          <GitHubIcon className="w-7 h-7 text-ink" />
        </Node>
        <Leg label="webhook" delay={0} />
        <Node label="Hub" sub="router">
          <HubIcon className="w-7 h-7 text-accent" />
        </Node>
        <Leg label="dispatch" delay={1.65} />
        <Node label="Outpost" sub="dev container">
          <ContainerIcon className="w-7 h-7 text-ink" />
        </Node>
      </div>
    </div>
  );
}

function Leg({ label, delay }: { label: string; delay: number }) {
  return (
    <div className="relative flex-1 flex flex-col items-center gap-2.5 -mt-7">
      <code className="font-mono text-[10px] sm:text-[13px] whitespace-nowrap text-accent-ink">{label}</code>
      <div className="relative w-full h-px bg-[linear-gradient(90deg,var(--color-accent-soft),var(--color-accent))]">
        <span
          aria-hidden
          style={{ animationDelay: `${delay}s` }}
          className="lightbox-travel absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-accent shadow-[0_0_0_4px_var(--color-card)]"
        />
        <svg viewBox="0 0 8 10" className="absolute -right-0.5 -top-[5px] w-2 h-2.5 text-accent" aria-hidden>
          <path d="M0 0 8 5 0 10z" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}

function Node({ label, sub, children }: { label: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 shrink-0">
      <span className="w-14 h-14 rounded-2xl bg-card border border-rule grid place-items-center">{children}</span>
      <span className="flex flex-col items-center gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-[11px] text-ink-3">{sub}</span>
      </span>
    </div>
  );
}
