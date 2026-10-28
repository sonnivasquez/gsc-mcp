import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/privacy")({
  head: () =>
    pageHead({
      path: "/privacy",
      title: "Privacy — where your Search Console data lives | gsc-mcp",
      description:
        "gsc-mcp privacy: OAuth tokens stay on your machine and tool responses travel only to your MCP client and its AI provider. No backend, no telemetry.",
    }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
      <p className="font-mono text-xs tracking-[0.14em] text-cobalt-deep">PRIVACY</p>
      <h1 className="mt-2 font-display text-[length:var(--ds-type-page)] font-semibold tracking-[-0.02em] text-balance text-ink">
        Where your data lives
      </h1>
      <p className="mt-3 leading-relaxed text-ink-soft">
        Local means no backend, no telemetry, no accounts. It does not mean
        responses stay on your machine.
      </p>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        The four places
      </h2>
      <div
        tabIndex={0}
        role="group"
        aria-label="Where your data lives: scrollable table"
        className="mt-3 overflow-x-auto rounded-xl border border-line bg-card"
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-4 py-3 font-semibold text-ink">
                What
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-ink">
                Where
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-ink">
                Who sees it
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-ink-soft">
            <tr>
              <td className="px-4 py-3">OAuth tokens / keys</td>
              <td className="px-4 py-3 font-mono text-sm">
                ~/.gsc-mcp/ (or GSC_DATA_DIR), dir 0700, file 0600
              </td>
              <td className="px-4 py-3">Only your machine and Google</td>
            </tr>
            <tr>
              <td className="px-4 py-3">Profiles (allowlists)</td>
              <td className="px-4 py-3 font-mono text-sm">
                Same directory, no secrets
              </td>
              <td className="px-4 py-3">Only your machine</td>
            </tr>
            <tr>
              <td className="px-4 py-3">Tool responses</td>
              <td className="px-4 py-3 font-mono text-sm">
                MCP process → your MCP client
              </td>
              <td className="px-4 py-3 font-semibold text-ink">
                Your client and its AI provider
              </td>
            </tr>
            <tr>
              <td className="px-4 py-3">Cache / datasets</td>
              <td className="px-4 py-3 font-mono text-sm">
                Process memory (15-minute datasets)
              </td>
              <td className="px-4 py-3">The local process</td>
            </tr>
            <tr>
              <td className="px-4 py-3">Optional change history</td>
              <td className="px-4 py-3">GSC_DATA_DIR/history or ~/.gsc-mcp/history, when explicitly enabled and saved</td>
              <td className="px-4 py-3">Your machine; returned records are also visible to your client and its AI provider</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        What &ldquo;local&rdquo; does not mean
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
        <li>
          &ldquo;Local&rdquo; means: no backend of ours, no telemetry, no
          accounts.
        </li>
        <li>
          It does NOT mean responses stay local: your MCP client sends them
          to its AI provider to draft the answer. Read your client&rsquo;s
          policy before querying sensitive properties.
        </li>
        <li>
          Your Search Console data goes direct from this machine to Google.
        </li>
        <li className="font-mono text-sm text-ink">
          You → this machine → Google, then tool response → your MCP client →
          its AI provider.
        </li>
      </ul>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        Cleanup
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
        <li>
          <code className="font-mono text-sm">auth logout</code> deletes
          the local OAuth session (it does not revoke at Google).
        </li>
        <li>
          <code className="font-mono text-sm">auth revoke --yes</code>{" "}
          revokes at Google and deletes locally.
        </li>
        <li>
          Deleting{" "}
          <code className="font-mono text-sm">~/.gsc-mcp/</code> removes
          all local state (tokens, profiles).
        </li>
        <li>
          Removing the client config never revokes the Google grant — revoke
          first if you want access gone. Full procedure:{" "}
          <a
            href="/docs/uninstall"
            className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt"
          >
            Uninstall
          </a>
          .
        </li>
      </ul>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        Minimum scopes
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
        <li>
          Single scope{" "}
          <code className="font-mono text-sm">webmasters.readonly</code>{" "}
          by default.
        </li>
        <li>
          <code className="font-mono text-sm">GSC_ACCESS_MODE=full</code>{" "}
          with Custom OAuth or a service account additionally requests{" "}
          <code className="font-mono text-sm">webmasters</code> and{" "}
          <code className="font-mono text-sm">indexing</code> and enables
          sitemap submissions and URL notifications.
        </li>
        <li>No Gmail, Drive, or Analytics scopes requested.</li>
        <li>
          Quick Connect uses the shared OAuth client and supports read-only
          access only. Full access requires your own OAuth client or
          a service account with the appropriate permissions.
        </li>
      </ul>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        Google API use
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
        <li>
          GSC MCP calls the Search Console and Indexing APIs directly from
          your machine. The developer operates no servers and receives no
          user data.
        </li>
        <li>
          Reads analyze your own verified properties when you ask your
          assistant. Writes run only when you choose full access and trigger
          them: sitemap submissions and URL notifications for your own
          properties.
        </li>
        <li>
          Image and on-demand website audits fetch authorized site resources
          for checks. Those fetches go to the site, not to Google.
        </li>
        <li>
          No advertising use. Optional export files stay on your machine and
          are never uploaded automatically.
        </li>
        <li>
          Tool responses travel to your MCP client and its AI provider to
          draft the answer. Retention on their side follows your
          client&rsquo;s policy, not this page. Before connecting, check your
          client and AI provider&rsquo;s retention, training, and human-review
          settings. GSC MCP does not control those services or guarantee that
          they exclude your data from training.
        </li>
        <li>
          Google&rsquo;s data rules live here:{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt"
          >
            Google API Services User Data Policy
          </a>
          . This page claims no verification or approval status.
        </li>
      </ul>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        Contact
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft [overflow-wrap:anywhere]">
        Maintainer: Sonni Vasquez —{" "}
        <a
          href="https://sonnivasquez.com"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt"
        >
          sonnivasquez.com
        </a>{" "}
        ·{" "}
        <a
          href="https://github.com/sonnivasquez"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt"
        >
          github.com/sonnivasquez
        </a>
        . No additional support email is published on this page.
      </p>
    </div>
  );
}
