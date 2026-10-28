import { createFileRoute } from "@tanstack/react-router";
import { CmdBlock, H2, Lead, Note, TopicLinks } from "@/components/doc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PKG_NAME, pageHead } from "@/lib/site";

export const Route = createFileRoute("/docs/uninstall")({
  head: () =>
    pageHead({
      path: "/docs/uninstall",
      title: "Uninstall Google Search Console MCP — gsc-mcp removal",
      description:
        "Remove the Google Search Console MCP server from your terminal and clients, revoke Google access, or delete local credentials only when you choose to.",
    }),
  component: UninstallPage,
});

function UninstallPage() {
  return (
    <article>
      <h1 className="mt-0 font-display font-semibold tracking-[-0.02em] text-balance text-ink">
        Uninstall Google Search Console MCP
      </h1>
      <Lead>
        Remove the global CLI and its entry from your MCP client. Your other client servers remain in place.
        Revoking Google access and deleting local credentials are separate optional steps.
      </Lead>

      <H2 id="client">Remove the MCP client entry</H2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-base leading-relaxed text-ink-soft">
        <li>Quit or stop the MCP client.</li>
        <li>In its MCP settings or config file, remove only the <code className="font-mono text-sm text-ink">gsc</code> server entry, or <code className="font-mono text-sm text-ink">gsc-local</code> if you added a generic template with that name.</li>
        <li>Save the settings and restart the client.</li>
      </ol>

      <H2 id="revoke">Optional: revoke Google access</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        If you want to revoke the OAuth grant, do it before uninstalling the CLI or deleting local data:
      </p>
      <CmdBlock
        title="Revoke Google access and remove the saved OAuth session"
        command="gsc auth revoke --yes"
        copyLabel="Copy Google revocation command"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        To remove only the local OAuth session without revoking access at Google, run{" "}
        <code className="font-mono text-sm text-ink">gsc auth logout</code> before uninstalling.
        Neither command removes service-account key files. For service-account access, disable or delete
        its key in Google Cloud and remove the account from each Search Console property's user list.
      </p>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Revoking the OAuth grant can also sign you out of other sessions that use the same app.
      </p>

      <H2 id="package">Remove the global package</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Use the package manager you chose during installation. Removing the package does
        not delete your Google tokens, profiles, or client configurations.
      </p>
      <Tabs defaultValue="npm" className="mt-4">
        <TabsList aria-label="Package manager">
          <TabsTrigger value="npm">npm</TabsTrigger>
          <TabsTrigger value="bun">Bun</TabsTrigger>
        </TabsList>
        <TabsContent value="npm">
          <CmdBlock
            title="Uninstall with npm"
            command={`npm uninstall -g ${PKG_NAME}`}
            copyLabel="Copy npm uninstall command"
          />
        </TabsContent>
        <TabsContent value="bun">
          <CmdBlock
            title="Uninstall with Bun"
            command={`bun remove -g ${PKG_NAME}`}
            copyLabel="Copy Bun uninstall command"
          />
        </TabsContent>
      </Tabs>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Updating instead? Install again with the same command to update without touching
        your tokens or client setup. See{" "}
        <a href="/docs#update" className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt">Update or reinstall</a>.
      </p>

      <H2 id="local-data">Optional: remove local credentials and data</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        If you want to remove saved change history, OAuth tokens, profiles, OAuth client files, and service-account keys,
        delete the data directory after you uninstall. This action is permanent.
      </p>
      <Note tone="warn" label="Deletes local files">
        These commands delete files only in the default <code className="font-mono text-sm">~/.gsc-mcp</code>
        directory. If you configured <code className="font-mono text-sm">GSC_DATA_DIR</code>, use that exact
        directory instead. Keys or credentials stored elsewhere are not removed.
      </Note>
      <Tabs defaultValue="macos" className="mt-4">
        <TabsList aria-label="Choose your operating system">
          <TabsTrigger value="macos">macOS / Linux</TabsTrigger>
          <TabsTrigger value="windows">Windows</TabsTrigger>
        </TabsList>
        <TabsContent value="macos">
          <CmdBlock
            title="Delete the default local data directory"
            command="rm -rf ~/.gsc-mcp"
            copyLabel="Copy macOS or Linux deletion command"
          />
        </TabsContent>
        <TabsContent value="windows">
          <CmdBlock
            title="Delete the default local data directory in PowerShell"
            command={`Remove-Item -Recurse -Force "$env:USERPROFILE\\.gsc-mcp"`}
            copyLabel="Copy Windows deletion command"
          />
          <p className="mt-3 text-base leading-relaxed text-ink-soft">
            Or delete the <code className="font-mono text-sm text-ink">.gsc-mcp</code> folder inside your user profile with File Explorer.
          </p>
        </TabsContent>
      </Tabs>
      <H2 id="next">Next</H2>
      <TopicLinks
        items={[
          { to: "/docs", label: "Install Google Search Console MCP again" },
          { to: "/docs/credentials", label: "Review credentials and Google access" },
          { to: "/docs/troubleshooting", label: "Troubleshoot client setup" },
        ]}
      />
    </article>
  );
}
