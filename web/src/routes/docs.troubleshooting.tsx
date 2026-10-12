import { createFileRoute } from "@tanstack/react-router";
import { H2, Lead, Note, TopicLinks, CmdBlock } from "@/components/doc";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/docs/troubleshooting")({
  head: () =>
    pageHead({
      path: "/docs/troubleshooting",
      title: "Troubleshoot Google Search Console MCP — fixes",
      description:
        "Fix missing MCP tools, Google sign-in failures, Search Console permission errors, API errors and partial results in the Google Search Console MCP server.",
    }),
  component: TroubleshootingPage,
});

function TroubleshootingPage() {
  return (
    <article>
      <h1 className="mt-0 font-display font-semibold tracking-[-0.02em] text-balance text-ink">
        Troubleshooting
      </h1>
      <Lead>
        Start with the symptom. Run <code className="font-mono text-sm text-ink">gsc doctor</code> for
        local setup details, then use the matching check below. Problems can come from your client,
        credentials, Search Console permissions, Google's APIs, or quotas.
      </Lead>

      <H2 id="old-version">My client still runs the old version after updating</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        The previous MCP server keeps running until you restart the client. Confirm the installed
        version with <code className="font-mono text-sm text-ink">gsc --version</code>, compare it
        with the registry using <code className="font-mono text-sm text-ink">gsc update --check</code>,
        then restart your MCP client. Updates never touch tokens, profiles, or client
        configurations.
      </p>

      <H2 id="no-tools">My client shows no tools</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Run <code className="font-mono text-sm text-ink">gsc doctor</code> in a terminal. If it passes,
        regenerate the client entry and follow its instructions:
      </p>
      <CmdBlock
        title="Print the client configuration"
        command="gsc config print --client cursor"
        copyLabel="Copy client configuration command"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Replace <code className="font-mono text-sm text-ink">cursor</code> with your client name,
        check that the printed runtime and package paths exist, then restart the client. You can also
        rerun <code className="font-mono text-sm text-ink">gsc setup --client cursor</code> to refresh its entry.
      </p>

      <H2 id="sign-in">Google sign-in fails or says AUTH_REQUIRED</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Check whether a session exists. For OAuth, start a new sign-in in your terminal and complete
        the browser flow:
      </p>
      <CmdBlock
        title="Check and restore OAuth sign-in"
        command={`gsc auth status\ngsc auth login`}
        copyLabel="Copy sign-in commands"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        If you use a service account, run <code className="font-mono text-sm text-ink">gsc doctor</code>
        and confirm the key file still exists at the configured path. Never paste its private key into a chat or website.
      </p>

      <H2 id="property">A property is missing or returns PROPERTY_NOT_ALLOWED</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Compare the requested ID with the allowlist shown by <code className="font-mono text-sm text-ink">gsc doctor</code>.
        Search Console IDs must match exactly, including the slash on URL-prefix properties and the{" "}
        <code className="font-mono text-sm text-ink">sc-domain:</code> prefix on domain properties. Running
        setup with <code className="font-mono text-sm text-ink">--site</code> replaces the selected allowlist,
        so include every property you want to retain:
      </p>
      <CmdBlock
        title="Configure the allowed properties"
        command="gsc setup --client cursor --site 'sc-domain:example.com' --site 'https://shop.example.com/'"
        copyLabel="Copy property setup command"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Repeat <code className="font-mono text-sm text-ink">--site</code> for each property. Tool calls cannot expand
        the configured allowlist on their own.
      </p>

      <H2 id="google-errors">I see a permission or API error</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Run the online check to distinguish local setup from Google access:
      </p>
      <CmdBlock
        title="Check Google access"
        command="gsc auth status --online"
        copyLabel="Copy online status command"
      />
      <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-ink-soft">
        <li><code className="font-mono text-sm text-ink">PROPERTY_PERMISSION_DENIED</code>: ask a Search Console Owner to grant the signed-in account or service account access to that property.</li>
        <li><code className="font-mono text-sm text-ink">API_DISABLED</code>: enable the Search Console API in the Cloud project that owns the credential.</li>
        <li><code className="font-mono text-sm text-ink">QUOTA_EXCEEDED</code> or <code className="font-mono text-sm text-ink">RATE_LIMITED</code>: reduce request volume or concurrency, narrow the query, and retry after the indicated interval. If you use your own OAuth project, check its project and per-user quotas in Google Cloud Console. Quick Connect uses the app's shared project, which you do not administer.</li>
      </ul>

      <H2 id="oauth">OAuth returns invalid_grant</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Google rejected the saved OAuth refresh token. Reconnect the account:
      </p>
      <CmdBlock
        title="Sign in again"
        command="gsc auth login"
        copyLabel="Copy sign-in command"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        If you created your own OAuth app and set its audience to External while it is in Testing,
        Google expires refresh tokens for these scopes after seven days. Move the app to Production
        and complete any consent requirements Google presents, or use a service account.
      </p>

      <H2 id="partial">A report is partial or exceeds its request budget</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Request fewer rows, shorten the date range, or split a large report into smaller queries.
        If a response identifies a missing page or slice, retry that part instead of repeating the full request.
      </p>

      <H2 id="expired">An export or page says DATASET_EXPIRED</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Run the source query again, then page or export its new result. Temporary datasets expire after 15 minutes.
      </p>

      <H2 id="writes">A write tool is unavailable</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Quick Connect is read-only. To use supported write tools, set up your own OAuth client or a
        service account with full access. For OAuth, rerun setup with{" "}
        <code className="font-mono text-sm text-ink">--auth custom --access full --reauth</code> and approve
        the additional Google scopes. A service account needs the required property permission.
        Changing the configured access mode alone does not add Google scopes or property permissions.
        Restart the client after setup. See <a href="/docs/credentials#scopes" className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt">Credentials</a>.
        The Indexing API accepts URL notifications only for eligible JobPosting or BroadcastEvent pages;
        it does not guarantee indexing.
      </p>

      <Note tone="info" label="Privacy and credentials">
        OAuth tokens and service-account keys stay in local files. Search Console results are sent to
        your MCP client and AI provider so they can answer your request. Their retention and training
        practices depend on their own settings. Read the <a href="/privacy" className="font-medium underline underline-offset-4">privacy page</a> before connecting.
      </Note>

      <H2 id="next">Next</H2>
      <TopicLinks
        items={[
          { to: "/docs/commands", label: "Browse the command reference" },
          { to: "/docs/credentials#scopes", label: "Review access scopes and credentials" },
          { to: "/docs/uninstall", label: "Remove the package or Google access" },
        ]}
      />
    </article>
  );
}
