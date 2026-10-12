import { createFileRoute } from "@tanstack/react-router";
import { CmdBlock, H2, Lead, Note, TopicLinks } from "@/components/doc";
import {
  EXAMPLE_DOMAIN_PROPERTY,
  TOKEN_DIR,
  pageHead,
} from "@/lib/site";

export const Route = createFileRoute("/docs/credentials")({
  head: () =>
    pageHead({
      path: "/docs/credentials",
      title: "Google credentials — Quick Connect, OAuth or service account",
      description:
        "Set up read-only Quick Connect or bring your own Google OAuth client or service account credentials for the Google Search Console MCP server.",
    }),
  component: CredentialsPage,
});

function CredentialsPage() {
  return (
    <article>
      <h1 className="mt-0 font-display font-semibold tracking-[-0.02em] text-balance text-ink">
        Google credentials
      </h1>
      <Lead>
        Start with Quick Connect. It needs no Google Cloud project and grants read-only access.
        Use your own OAuth client or a service account if you need Google write operations.
      </Lead>
      <H2 id="setup-step-1">Answer setup step 1</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Setup asks two questions up front. Press Enter to accept each default, or type the number
        of the option you want.
      </p>
      <ol className="mt-3 list-decimal space-y-3 pl-5 text-base leading-relaxed text-ink-soft">
        <li>
          Authentication: <code className="font-mono text-sm text-ink">Quick Connect (recommended, read-only, no indexing)</code>,{" "}
          <code className="font-mono text-sm text-ink">Custom OAuth (full access, indexing)</code>, or{" "}
          <code className="font-mono text-sm text-ink">Service Account (full access, indexing)</code>.
          Quick Connect is read-only; full access needs your own OAuth client or a service account.
        </li>
        <li>
          Access level (skipped for Quick Connect): <code className="font-mono text-sm text-ink">Read only (data only)</code> or{" "}
          <code className="font-mono text-sm text-ink">Full (data + indexing)</code>. Full access asks
          a separate confirmation before enabling Google write operations.
        </li>
      </ol>

      <H2 id="quick-connect">Quick Connect</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Quick Connect uses the shared OAuth app and the <code className="font-mono text-sm text-ink">webmasters.readonly</code> scope.
        It cannot submit sitemaps or send URL indexing notifications. Setup opens Google sign-in,
        lets you choose properties, and saves the OAuth token on your machine under{" "}
        <code className="font-mono text-sm text-ink">{TOKEN_DIR}</code>.
      </p>
      <CmdBlock
        title="Connect a client with read-only Quick Connect"
        command="gsc setup --client desktop --auth shared --access readonly"
        copyLabel="Copy Quick Connect command"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Replace <code className="font-mono text-sm text-ink">desktop</code> with{" "}
        <code className="font-mono text-sm text-ink">code</code>,{" "}
        <code className="font-mono text-sm text-ink">cursor</code>,{" "}
        <code className="font-mono text-sm text-ink">codex</code>,{" "}
        <code className="font-mono text-sm text-ink">opencode</code>, or{" "}
        <code className="font-mono text-sm text-ink">pi</code> for another supported client.
        Google sign-in happens in your browser. Your MCP client and AI provider receive the tool
        results, subject to their own data policies. See the <a href="/privacy" className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt">privacy page</a> for details.
      </p>

      <H2 id="scopes">Read-only and full access</H2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-ink-soft">
        <li>
          <code className="font-mono text-sm text-ink">Read only (data only)</code> is the default. It requests
          only <code className="font-mono text-sm text-ink">webmasters.readonly</code> and enables Search Console reads.
        </li>
        <li>
          <code className="font-mono text-sm text-ink">Full (data + indexing)</code> adds the Search Console write
          scope <code className="font-mono text-sm text-ink">webmasters</code> and Indexing API scope{" "}
          <code className="font-mono text-sm text-ink">indexing</code>. It can submit sitemaps and send URL
          notifications. Indexing API notifications are limited to eligible pages with JobPosting or
          BroadcastEvent markup. Setup still asks a separate yes-or-no question before enabling writes.
        </li>
        <li>
          Quick Connect is read-only. Choose custom OAuth or a service account for full access.
          The authenticated Google account or service account still needs permission for each property.
        </li>
        <li>
          <code className="font-mono text-sm text-ink">--yes</code> accepts the defaults, so it never
          turns on write operations, the sample query, or the agent skill install.
        </li>
      </ul>

      <H2 id="oauth">Use your own OAuth client</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        This option uses your Google Cloud project and works with read-only or full access.
      </p>
      <ol className="mt-3 list-decimal space-y-3 pl-5 text-base leading-relaxed text-ink-soft">
        <li>
          Create or select a Google Cloud project and enable the Search Console API.
        </li>
        <li>
          In Google Auth Platform, set the app name, support email, audience, and requested scopes.
          External apps in Testing can use up to 100 listed test accounts; refresh tokens for these
          non-basic scopes expire after seven days. Follow Google's consent and verification steps
          for the scopes and audience you choose.
        </li>
        <li>
          Create an OAuth client with application type <strong className="font-semibold text-ink">Desktop app</strong>
          and download its JSON file. Setup currently requires a redirect URI that starts with{" "}
          <code className="font-mono text-sm text-ink">http://127.0.0.1</code>. It rejects files
          that list only <code className="font-mono text-sm text-ink">localhost</code> or{" "}
          <code className="font-mono text-sm text-ink">[::1]</code>; do not edit Google's JSON to bypass that check.
        </li>
        <li>
          Keep the JSON on your machine. For example, store it at{" "}
          <code className="font-mono text-sm text-ink">{TOKEN_DIR}client-secrets.json</code> and
          restrict access to your account:
          <CmdBlock
            title="Create a private credentials directory"
            command={`mkdir -p ~/.gsc-mcp && chmod 0700 ~/.gsc-mcp\nchmod 0600 ~/.gsc-mcp/client-secrets.json`}
            copyLabel="Copy credential file permission commands"
          />
        </li>
        <li>
          Run setup with your client JSON and exact Search Console property ID:
          <CmdBlock
            title="Set up Desktop OAuth"
            command={`gsc setup --client desktop --auth custom --secrets ~/.gsc-mcp/client-secrets.json --access readonly --site '${EXAMPLE_DOMAIN_PROPERTY}'`}
            copyLabel="Copy custom OAuth setup command"
          />
          Replace the example property with your own ID. Add <code className="font-mono text-sm text-ink">--site</code> again for each additional property.
          Use <code className="font-mono text-sm text-ink">--access full</code> only when you need write operations.
        </li>
      </ol>
      <Note tone="info" label="Desktop OAuth file">
        A Desktop OAuth client secret cannot be kept secret inside an installed app. Keep your
        downloaded file out of source control and protect your local OAuth token. Never share or
        publish user tokens or service-account private keys.
      </Note>

      <H2 id="service-account">Use a service account</H2>
      <ol className="mt-3 list-decimal space-y-3 pl-5 text-base leading-relaxed text-ink-soft">
        <li>
          In a Google Cloud project, enable the Search Console API, create a service account, and
          download a JSON key. Store the key at{" "}
          <code className="font-mono text-sm text-ink">{TOKEN_DIR}service-account.json</code> and
          restrict it to your account:
          <CmdBlock
            title="Protect the service-account key file"
            command={`mkdir -p ~/.gsc-mcp && chmod 0700 ~/.gsc-mcp\nchmod 0600 ~/.gsc-mcp/service-account.json`}
            copyLabel="Copy service-account key permissions"
          />
        </li>
        <li>
          In Search Console, add the service account's <code className="font-mono text-sm text-ink">client_email</code>
          to each property. An Owner must grant property access. Use a permission level that allows
          the operations you need.
        </li>
        <li>
          Run setup with the key path and property ID:
          <CmdBlock
            title="Set up a service account"
            command={`gsc setup --client desktop --auth service-account --key-file ~/.gsc-mcp/service-account.json --access readonly --site '${EXAMPLE_DOMAIN_PROPERTY}'`}
            copyLabel="Copy service-account setup command"
          />
          Use <code className="font-mono text-sm text-ink">--access full</code> for supported write operations.
          Indexing API requests also require the service account to be an eligible owner and the page
          to use JobPosting or BroadcastEvent markup.
        </li>
      </ol>

      <H2 id="sources">Google setup references</H2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-ink-soft">
        {[
          ["OAuth for desktop apps", "https://developers.google.com/identity/protocols/oauth2/native-app"],
          ["Create a Desktop OAuth client", "https://support.google.com/cloud/answer/15549257"],
          ["OAuth audience and testing status", "https://support.google.com/cloud/answer/15549945?hl=en"],
          ["Create and protect service-account keys", "https://cloud.google.com/iam/docs/keys-create-delete"],
          ["Search Console users and permissions", "https://support.google.com/webmasters/answer/7687615?hl=en"],
          ["Search Console API scopes and quotas", "https://developers.google.com/webmaster-tools/limits"],
          ["Indexing API prerequisites", "https://developers.google.com/search/apis/indexing-api/v3/prereqs"],
        ].map(([label, href]) => (
          <li key={href}>
            <a href={href} target="_blank" rel="noreferrer" className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt">
              {label}
            </a>
          </li>
        ))}
      </ul>

      <H2 id="next">Next</H2>
      <TopicLinks
        items={[
          { to: "/docs/clients", label: "Connect your MCP client" },
          { to: "/docs/commands", label: "Browse the command reference" },
          { to: "/docs/troubleshooting", label: "Fix connection or access problems" },
        ]}
      />
    </article>
  );
}
