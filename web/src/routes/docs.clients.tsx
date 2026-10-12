import { createFileRoute } from "@tanstack/react-router";
import { CmdBlock, H2, Lead, TopicLinks } from "@/components/doc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/docs/clients")({
  head: () =>
    pageHead({
      path: "/docs/clients",
      title: "Connect Claude, Cursor or Codex — Google Search Console MCP",
      description:
        "Connect the Google Search Console MCP server to Claude Desktop, Claude Code, Cursor, Codex or any MCP client with copy-paste configuration snippets.",
    }),
  component: ClientsPage,
});

const CLIENTS = [
  { key: "desktop", label: "Claude Desktop (app)" },
  { key: "code", label: "Claude Code (terminal)" },
  { key: "cursor", label: "Cursor (editor)" },
  { key: "codex", label: "Codex (terminal)" },
  { key: "opencode", label: "OpenCode" },
  { key: "pi", label: "Pi (OhMyPi)" },
] as const;

function ClientsPage() {
  return (
    <article>
      <h1 className="mt-0 font-display font-semibold tracking-[-0.02em] text-balance text-ink">
        Connect your MCP client
      </h1>
      <Lead>
        Install Google Search Console MCP once, then run one setup command for your client.
      </Lead>

      <H2 id="connect">Choose your client</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Run the command for the app you use. Setup signs in to Google, lets you select Search Console
        properties, then configures or prints the client steps. Quick Connect uses read-only access.
        Setup runs quietly by default; add <code className="font-mono text-sm text-ink">--verbose</code> or{" "}
        <code className="font-mono text-sm text-ink">--dry-run</code> for the full detail.
      </p>
      <Tabs defaultValue="desktop" className="mt-4">
        <TabsList aria-label="Choose an MCP client" className="flex h-auto flex-wrap">
          {CLIENTS.map((client) => (
            <TabsTrigger key={client.key} value={client.key}>
              {client.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {CLIENTS.map((client) => (
          <TabsContent key={client.key} value={client.key}>
            <CmdBlock
              title={`Set up ${client.label}`}
              command={`gsc setup --client ${client.key}`}
              copyLabel={`Copy ${client.label} setup command`}
            />
          </TabsContent>
        ))}
      </Tabs>

      <ul className="mt-4 list-disc space-y-2 pl-5 text-base leading-relaxed text-ink-soft">
        <li>Answer with target numbers (for example <code className="font-mono text-sm text-ink">1,3</code>), <code className="font-mono text-sm text-ink">all</code> for every installer, or Enter for the default.</li>
        <li>Follow setup's preview and approve the client configuration change.</li>
        <li>Complete Google sign-in in your browser, then restart the client.</li>
        <li>Setup preserves other MCP server entries when it updates a supported config file.</li>
        <li>OpenCode and Pi are configured globally only: OpenCode merges into <code className="font-mono text-sm text-ink">~/.config/opencode/opencode.json</code> under the <code className="font-mono text-sm text-ink">mcp</code> key, and Pi merges into <code className="font-mono text-sm text-ink">~/.omp/agent/mcp.json</code> under <code className="font-mono text-sm text-ink">mcpServers</code>.</li>
      </ul>

      <H2 id="other-clients">Other MCP clients</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        For an app without a built-in setup target, choose the JSON output destination during setup
        or print a generic configuration and add it through that app's MCP settings. The template
        uses absolute runtime and package paths.
      </p>
      <CmdBlock
        title="Print a generic MCP configuration"
        command="gsc config print --client generic"
        copyLabel="Copy generic configuration command"
      />

      <H2 id="verify">Check the connection</H2>
      <CmdBlock
        title="Verify Google access"
        command={`gsc doctor\ngsc auth status --online`}
        copyLabel="Copy verification commands"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        The client should show the Google Search Console MCP tools after you restart it. If it does not,
        see <a href="/docs/troubleshooting#no-tools" className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt">Troubleshooting</a>.
      </p>

      <H2 id="next">More help</H2>
      <TopicLinks
        items={[
          { to: "/docs", label: "Install Google Search Console MCP" },
          { to: "/docs/credentials", label: "Choose a credential and access mode" },
          { to: "/docs/commands", label: "Browse the command reference" },
        ]}
      />
    </article>
  );
}
