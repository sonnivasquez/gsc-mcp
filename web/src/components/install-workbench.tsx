import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { CopyButton } from "@/components/copy-button";

const STEPS = [
  {
    title: "Install once",
    body: "Choose curl, npm, or Bun above. Node.js 22 or newer runs gsc; Bun can install the package globally too.",
  },
  {
    title: "Connect Google",
    body: "Run Quick Connect, sign in in the browser, and choose the Search Console property you want to use. Quick Connect is read-only.",
    to: "/docs/credentials",
    cta: "Credential options",
  },
  {
    title: "Connect your client",
    body: "Choose your MCP client in setup, review the configuration preview, and approve it. Restart an already-open client to load the new server.",
    to: "/docs/clients",
    cta: "Client instructions",
  },
] as const;

export function InstallWorkbench({ id = "install" }: { id?: string }) {
  const verifyId = useId();

  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
      <div className="overflow-hidden rounded-2xl bg-panel text-bright shadow-[var(--home-workbench-shadow)]">
        <div className="border-b border-panel-line px-5 pt-6 pb-5 sm:px-8">
          <h2
            id={`${id}-heading`}
            className="mt-0 max-w-xl font-display text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl"
          >
            Install, connect, and start with read-only access.
          </h2>
        </div>

        <div className="px-5 py-6 sm:px-8">
          <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-panel-line bg-panel-line sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="bg-panel p-5">
                <p className="flex items-center gap-2 font-mono text-xs text-panel-faint">
                  <span
                    aria-hidden="true"
                    className="flex size-5 items-center justify-center rounded-full bg-cobalt font-mono text-xs font-semibold text-bright"
                  >
                    {index + 1}
                  </span>
                  STEP {index + 1} OF 3
                </p>
                <p className="mt-2 font-semibold text-bright">{step.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-panel-soft">{step.body}</p>
                {"to" in step ? (
                  <p className="mt-2 text-sm">
                    <Link
                      to={step.to}
                      className="font-medium text-bright underline decoration-cobalt decoration-2 underline-offset-4 hover:decoration-bright"
                    >
                      {step.cta} →
                    </Link>
                  </p>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="mt-4 overflow-hidden rounded-xl border border-panel-line bg-panel-raised">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-panel-line px-4 py-2.5">
              <p className="min-w-0 font-mono text-xs text-panel-soft [overflow-wrap:anywhere]">
                Check your installation
              </p>
              <CopyButton
                text="gsc doctor"
                label="Copy verification command"
                targetId={verifyId}
                className="border-panel-line bg-transparent text-bright hover:bg-bright/10 hover:text-bright"
              />
            </div>
            <pre
              tabIndex={0}
              role="group"
              aria-label="Verification command: scrollable code"
              className="overflow-x-auto p-4 font-mono text-sm leading-relaxed text-bright"
            >
              <code id={verifyId} tabIndex={-1}>gsc doctor</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
