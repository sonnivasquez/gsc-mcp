import { createFileRoute } from "@tanstack/react-router";
import { CmdBlock, H2, Lead, Note, TopicLinks } from "@/components/doc";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/docs/commands")({
  head: () =>
    pageHead({
      path: "/docs/commands",
      title: "gsc-mcp commands — Google Search Console MCP reference",
      description:
        "Find the gsc-mcp command you need for Google Search Console MCP setup, diagnostics, authentication, configuration, or running the local MCP server.",
    }),
  component: CommandsPage,
});

function CommandsPage() {
  return (
    <article>
      <h1 className="mt-0 font-display font-semibold tracking-[-0.02em] text-balance text-ink">
        Command reference
      </h1>
      <Lead>
        Use <code className="font-mono text-sm text-ink">gsc</code> for setup and maintenance.
        Your MCP client starts the server automatically after setup.
      </Lead>

      <H2 id="everyday">Common commands</H2>
      <CmdBlock
        title="Set up, check, and sign in"
        command={`gsc setup\ngsc doctor\ngsc auth status\ngsc auth status --online\ngsc --help\ngsc --version`}
        copyLabel="Copy common commands"
      />

      <H2 id="setup">Connect Google and a client</H2>
      <CmdBlock
        title="Example: connect Cursor with read-only Quick Connect"
        command="gsc setup --client cursor --auth shared --access readonly"
        copyLabel="Copy setup example"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Setup opens Google sign-in, lets you choose Search Console properties, and configures the client.
        It runs quietly by default: add <code className="font-mono text-sm text-ink">--verbose</code> for
        the full detail (JSON entries, paths, and verification) or{" "}
        <code className="font-mono text-sm text-ink">--dry-run</code> to preview without changes.
        Replace <code className="font-mono text-sm text-ink">cursor</code> with{" "}
        <code className="font-mono text-sm text-ink">desktop</code>,{" "}
        <code className="font-mono text-sm text-ink">code</code>,{" "}
        <code className="font-mono text-sm text-ink">codex</code>,{" "}
        <code className="font-mono text-sm text-ink">opencode</code>, or{" "}
        <code className="font-mono text-sm text-ink">pi</code>. For other clients, use{" "}
        <code className="font-mono text-sm text-ink">generic</code> or{" "}
        <code className="font-mono text-sm text-ink">print</code> to generate a configuration.
      </p>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-ink-soft">
        <li><code className="font-mono text-sm text-ink">--client &lt;target&gt;</code> selects the destination (repeatable or comma-separated). OpenCode and Pi are configured globally only.</li>
        <li><code className="font-mono text-sm text-ink">--auth shared|custom|service-account</code> chooses Quick Connect, your OAuth client, or a service account.</li>
        <li><code className="font-mono text-sm text-ink">--access readonly|full</code> selects access. Read-only is the default; Quick Connect supports read-only only.</li>
        <li><code className="font-mono text-sm text-ink">--site &lt;property-id&gt;</code> may be repeated, once per exact property ID. Use <code className="font-mono text-sm text-ink">--site all</code> alone or <code className="font-mono text-sm text-ink">--all-sites</code> to allow all current and future properties. The options are mutually exclusive.</li>
        <li><code className="font-mono text-sm text-ink">--secrets &lt;path&gt;</code> supplies a Desktop OAuth JSON file. <code className="font-mono text-sm text-ink">--key-file &lt;path&gt;</code> supplies a service-account JSON file.</li>
        <li><code className="font-mono text-sm text-ink">--dry-run</code> previews setup without Google sign-in or client changes. <code className="font-mono text-sm text-ink">--reauth</code> starts a fresh OAuth sign-in. <code className="font-mono text-sm text-ink">--verbose</code> prints the full detail.</li>
        <li><code className="font-mono text-sm text-ink">--force</code> or <code className="font-mono text-sm text-ink">--yes</code> skips the client configuration confirmation. <code className="font-mono text-sm text-ink">--yes</code> never opts in to writes, the sample query, or the skill install. <code className="font-mono text-sm text-ink">--language en|es</code> sets setup language.</li>
      </ul>

      <H2 id="access">Change an existing access mode</H2>
      <CmdBlock
        title="Change a client to read-only"
        command="gsc setup access readonly --client cursor"
        copyLabel="Copy read-only access command"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Use <code className="font-mono text-sm text-ink">full</code> only when you need Google write operations.
        This changes the client configuration only. Quick Connect remains read-only. For OAuth, rerun setup with{" "}
        <code className="font-mono text-sm text-ink">--auth custom --access full --reauth</code> and approve the
        additional Google scopes. A service account needs the required property permission. Restart the client after setup.
      </p>

      <H2 id="deprecated">Deprecated write flags</H2>
      <Note tone="info" label="Legacy command options">
        New setups should use <code className="font-mono text-sm">--access readonly|full</code>.
        The older write commands remain for existing configurations.
      </Note>
      <CmdBlock
        title="Legacy write commands"
        command={`gsc setup enable-write --client cursor\ngsc setup disable-write --client cursor`}
        copyLabel="Copy legacy write commands"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        <code className="font-mono text-sm text-ink">--scopes</code> and{" "}
        <code className="font-mono text-sm text-ink">--enable-write</code> are also legacy setup flags.
        The write commands warn first (writes make real changes in Google, limited to 200 URL
        notifications per day), need confirmation, and refuse Quick Connect installs.
      </p>

      <H2 id="server">MCP server</H2>
      <CmdBlock
        title="Start the server manually"
        command={`gsc serve\ngsc serve --profile reporting`}
        copyLabel="Copy server commands"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        MCP clients normally start the server for you. A profile uses its own property allowlist and
        datasets. In-memory datasets expire after 15 minutes.
      </p>

      <H2 id="tools">MCP tools</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">Explore the <a href="/docs/tools" className="text-cobalt-deep underline">complete MCP tool catalog</a> and access requirements.</p>
      <H2 id="audits">On-demand audits</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">See the <a href="/docs/audits" className="text-cobalt-deep underline">audit guide</a> for inputs, limits, continuation, and evidence. The <a href="/docs/history" className="text-cobalt-deep underline">history guide</a> covers optional local records and snapshots.</p>
      <H2 id="analytics">Analytics dimensions</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">See <a href="/docs/analytics" className="text-cobalt-deep underline">analytics and timelines</a> for hourly data, search appearances, report rules, and coverage.</p>

      <H2 id="doctor">Diagnose the installation</H2>
      <CmdBlock
        title="Run local or online checks"
        command={`gsc doctor\ngsc doctor --online`}
        copyLabel="Copy diagnostic commands"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        The local check reports runtime, paths, configuration, and authentication state without printing
        secrets. The online check also validates access to Search Console and includes a version check
        against the npm registry that never fails on version drift.
      </p>
      <CmdBlock
        title="Compare installed and registry versions without installing"
        command="gsc update --check"
        copyLabel="Copy update check command"
      />

      <H2 id="auth">Manage Google sign-in</H2>
      <CmdBlock
        title="Sign in, check status, or remove a session"
        command={`gsc auth login\ngsc auth status\ngsc auth status --online\ngsc auth logout\ngsc auth revoke --yes`}
        copyLabel="Copy authentication commands"
      />
      <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-ink-soft">
        <li><code className="font-mono text-sm text-ink">auth login</code> starts Google sign-in in the browser.</li>
        <li><code className="font-mono text-sm text-ink">auth logout</code> removes the local OAuth session. It does not revoke access at Google.</li>
        <li><code className="font-mono text-sm text-ink">auth revoke --yes</code> revokes the cached OAuth grant at Google and removes the local session. Use it only when you want to revoke access.</li>
      </ul>

      <H2 id="config">Print client configuration</H2>
      <CmdBlock
        title="Generate a configuration snippet"
        command={`gsc config print --client desktop\ngsc config print --client generic`}
        copyLabel="Copy configuration commands"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        The output uses absolute runtime and package paths. <code className="font-mono text-sm text-ink">generic</code>
        prints JSON for another MCP client; it does not edit that client's settings.
      </p>

      <H2 id="environment">Environment variables</H2>
      <div tabIndex={0} role="group" aria-label="Environment variables" className="mt-3 overflow-x-auto rounded-[var(--ds-radius-lg)] border border-line bg-card">
        <table className="w-full text-left text-base">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-4 py-3 font-semibold text-ink">Variable</th>
              <th scope="col" className="px-4 py-3 font-semibold text-ink">Purpose</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-ink-soft">
            {[
              ["GSC_ACCESS_MODE", "readonly or full; defaults to readonly"],
              ["GSC_SITE_URLS", "JSON array of exact property IDs, or all by explicit opt-in"],
              ["GSC_AUTH_MODE", "oauth or service_account; defaults to service_account"],
              ["GSC_DATA_DIR", "Local data directory; defaults to ~/.gsc-mcp"],
              ["GSC_HISTORY", "Set to 1 to enable explicit local change records and saved measurements"],
              ["GSC_OAUTH_SECRETS_FILE", "Path to your Desktop OAuth JSON file"],
              ["GSC_OAUTH_CLIENT_ID", "OAuth client ID fallback when no secrets file is set"],
              ["GSC_OAUTH_CLIENT_SECRET", "OAuth client secret fallback when no secrets file is set"],
              ["GSC_KEY_FILE", "Path to your service-account JSON file"],
              ["GSC_SCOPES", "Legacy scope mode; prefer GSC_ACCESS_MODE"],
              ["GSC_ENABLE_WRITE", "Legacy write flag. Prefer GSC_ACCESS_MODE."],
            ].map(([name, purpose]) => (
              <tr key={name}>
                <td className="px-4 py-3 font-mono text-sm text-ink">{name}</td>
                <td className="px-4 py-3">{purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="opt-ins">Optional setup actions</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        <code className="font-mono text-sm text-ink">--first-query</code> runs one small Search Analytics query
        for the last seven days on the first selected property. It returns up to five rows and does not request query strings.
        <code className="font-mono text-sm text-ink"> --install-skill</code> installs the Google Search Console skill for supported agents.
        Setup asks before either action. <code className="font-mono text-sm text-ink">--yes</code> does not opt in to them.
      </p>

      <H2 id="help">Help and version</H2>
      <CmdBlock
        title="Show CLI help and installed version"
        command={`gsc --help\ngsc --version`}
        copyLabel="Copy help commands"
      />

      <H2 id="next">Next</H2>
      <TopicLinks
        items={[
          { to: "/docs/troubleshooting", label: "Find a fix by symptom" },
          { to: "/docs/credentials", label: "Review credentials and access modes" },
          { to: "/docs/uninstall", label: "Remove the package and client entry" },
        ]}
      />
    </article>
  );
}
