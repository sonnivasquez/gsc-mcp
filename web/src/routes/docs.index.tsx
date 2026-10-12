import { createFileRoute } from "@tanstack/react-router";
import { AgentInstall } from "@/components/agent-install";
import { CmdBlock, H2, Lead, Note, TopicLinks } from "@/components/doc";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { PINNED_SPEC, PKG_NAME, SETUP_COMMAND, pageHead } from "@/lib/site";

export const Route = createFileRoute("/docs/")({
  head: () =>
    pageHead({
      path: "/docs",
      title: "Install Google Search Console MCP — gsc-mcp setup guide",
      description:
        "Install the Google Search Console MCP server globally, connect your Google account and MCP client, then verify the connection. Read-only by default.",
    }),
  component: InstallationPage,
});

function InstallationPage() {
  return (
    <article>
      <h1 className="mt-0 font-display font-semibold tracking-[-0.02em] text-balance text-ink">
        Install Google Search Console MCP
      </h1>
      <Lead>
        Install the CLI, connect Google Search Console, configure your MCP client,
        and check the connection.
      </Lead>

      <H2 id="requirements">Before you start</H2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-ink-soft">
        <li>
          Install <strong className="font-semibold text-ink">Node.js 22 or newer</strong>.
          Bun can manage the global package, but the CLI runs on Node.js.
        </li>
        <li>
          Use a Google account with access to at least one Search Console property.
        </li>
      </ul>

      <H2 id="install">Choose an install method</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Each option installs the latest package globally and starts setup. Keep the
        global command directory on your PATH so you can run <code className="font-mono text-sm text-ink">gsc</code> later.
      </p>
      <Tabs defaultValue="curl" className="mt-4">
        <TabsList aria-label="Install method" className="flex h-auto flex-wrap">
          <TabsTrigger value="curl">curl</TabsTrigger>
          <TabsTrigger value="npm">npm</TabsTrigger>
          <TabsTrigger value="bun">Bun</TabsTrigger>
          <TabsTrigger value="agent">AI agent</TabsTrigger>
        </TabsList>
        <TabsContent value="curl">
          <CmdBlock
            title="Install with curl and npm"
            command="curl -fsSL https://gscmcp.dev/install.sh | sh"
            copyLabel="Copy curl install command"
          />
          <p className="mt-3 text-base leading-relaxed text-ink-soft">
            The installer uses npm by default and starts Quick Connect. To use Bun instead:
          </p>
          <CmdBlock
            title="Install with curl and Bun"
            command="curl -fsSL https://gscmcp.dev/install.sh | sh -s -- --manager bun"
            copyLabel="Copy curl install command with Bun"
          />
        </TabsContent>
        <TabsContent value="npm">
          <CmdBlock
            title="Install globally with npm and start setup"
            command={SETUP_COMMAND.node}
            copyLabel="Copy npm install command"
          />
        </TabsContent>
        <TabsContent value="bun">
          <CmdBlock
            title="Install globally with Bun and start setup"
            command={SETUP_COMMAND.bun}
            copyLabel="Copy Bun install command"
          />
        </TabsContent>
        <TabsContent value="agent">
          <AgentInstall />
        </TabsContent>
      </Tabs>

      <H2 id="connect">Connect Google and your MCP client</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Setup guides you in three steps: sign in with Quick Connect (recommended, read-only),
        choose your Search Console properties, and choose where to install. Sign in in the
        browser and approve the configuration change when setup shows it. Setup runs quietly
        by default; add <code className="font-mono text-sm text-ink">--verbose</code> or{" "}
        <code className="font-mono text-sm text-ink">--dry-run</code> for the full detail.
      </p>
      <CmdBlock
        title="Start setup again at any time"
        command="gsc setup"
        copyLabel="Copy setup command"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Need Google write operations? Use your own OAuth client or a service account.
        See <a href="/docs/credentials" className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt">Credentials</a> for the setup steps and access limits.
      </p>

      <H2 id="verify">Verify the connection</H2>
      <CmdBlock
        title="Check the CLI and Google connection"
        command={`gsc doctor\ngsc auth status --online`}
        copyLabel="Copy verification commands"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Then restart your MCP client and confirm that Google Search Console MCP tools appear.
        <code className="font-mono text-sm text-ink"> gsc doctor</code> checks the local setup;
        <code className="font-mono text-sm text-ink"> gsc auth status --online</code> checks Google access.
      </p>

      <H2 id="properties">Choose specific properties</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Setup limits the MCP server to the properties you select. Interactively, press Enter for
        the first property, pick numbers for an explicit allowlist, or choose{" "}
        <code className="font-mono text-sm text-ink">[0]</code> (or{" "}
        <code className="font-mono text-sm text-ink">all</code>) for all current and future properties,
        which warns and asks for a second confirmation. When you run setup again with{" "}
        <code className="font-mono text-sm text-ink">--site</code>, include every property you want
        to keep in the allowlist. Pass one exact property ID per flag. Use{" "}
        <code className="font-mono text-sm text-ink">--site all</code> alone or{" "}
        <code className="font-mono text-sm text-ink">--all-sites</code> only when you want to
        allow every current and future property on the account.
      </p>
      <CmdBlock
        title="Configure the full property allowlist"
        command="gsc setup --site 'sc-domain:example.com' --site 'https://shop.example.com/'"
        copyLabel="Copy property setup example"
      />

      <H2 id="update">Update or reinstall</H2>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Updates never break a working install. If a major change requires migration, the
        tool performs it automatically with a backup of your configuration; it never asks
        you for manual steps.
      </p>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        The assisted option compares your installed version against the npm registry
        and, when behind, reinstalls the package for your current runtime, verifies
        the new version, and reminds you to restart:
      </p>
      <CmdBlock
        title="Update with the assisted updater"
        command="gsc update"
        copyLabel="Copy assisted update command"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        To compare versions without installing anything, run{" "}
        <code className="font-mono text-sm text-ink">gsc update --check</code>. If your
        installed build is ahead of the registry, it reports that and changes nothing —{" "}
        it never downgrades. <code className="font-mono text-sm text-ink">gsc doctor --online</code>{" "}
        includes the same version check without failing.
      </p>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Or install again manually with your preferred package manager to update:
      </p>
      <Tabs defaultValue="npm" className="mt-4">
        <TabsList aria-label="Package manager">
          <TabsTrigger value="npm">npm</TabsTrigger>
          <TabsTrigger value="bun">Bun</TabsTrigger>
        </TabsList>
        <TabsContent value="npm">
          <CmdBlock
            title="Update with npm"
            command={`npm install -g ${PKG_NAME}`}
            copyLabel="Copy npm update command"
          />
        </TabsContent>
        <TabsContent value="bun">
          <CmdBlock
            title="Update with Bun"
            command={`bun install -g ${PKG_NAME}`}
            copyLabel="Copy Bun update command"
          />
        </TabsContent>
      </Tabs>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        After updating, check with <code className="font-mono text-sm text-ink">gsc --version</code> and{" "}
        <strong className="font-semibold text-ink">restart your MCP client</strong>: the previous
        server keeps running until you restart it.
      </p>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        To stay on a specific version or roll back, pin the version:
      </p>
      <CmdBlock
        title="Pin a specific version"
        command={`npm install -g ${PINNED_SPEC}`}
        copyLabel="Copy version pin command"
      />
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Updating, pinning, or rolling back never touches your Google tokens, profiles, or
        client configurations. To remove the CLI entirely, see{" "}
        <a href="/docs/uninstall" className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt">Uninstall</a>.
      </p>
      <Note tone="info" label="En español">
        <p className="m-0 font-semibold text-ink">En español</p>
        <p className="mt-2">
          Las actualizaciones nunca rompen una instalación que funciona. Si un cambio
          grande requiere migración, la herramienta la hace sola con respaldo de tu
          configuración; nunca te pedirá pasos manuales.
        </p>
        <p className="mt-2">
          También puedes actualizar con el asistente{" "}
          <code className="font-mono text-sm text-ink">gsc update</code> (
          <code className="font-mono text-sm text-ink">gsc update --check</code> solo
          compara versiones, sin instalar), o vuelve a instalar con tu gestor preferido:{" "}
          <code className="font-mono text-sm text-ink">npm install -g {PKG_NAME}</code> o{" "}
          <code className="font-mono text-sm text-ink">bun install -g {PKG_NAME}</code>.
          Después, comprueba con <code className="font-mono text-sm text-ink">gsc --version</code> y{" "}
          <strong className="font-semibold text-ink">reinicia tu cliente MCP</strong>: el servidor
          anterior sigue corriendo hasta que lo reinicies.
        </p>
        <p className="mt-2">
          Para quedarte en una versión concreta o volver atrás, indica la versión
          (<code className="font-mono text-sm text-ink">npm install -g {PINNED_SPEC}</code>).
          Actualizar, fijar o revertir versión no toca tus tokens de Google, tus perfiles
          ni la configuración de tus clientes. Para quitar el CLI, consulta la{" "}
          <a href="/docs/uninstall" className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt">guía de desinstalación</a>.
        </p>
      </Note>

      <H2 id="next">Next</H2>
      <TopicLinks
        items={[
          { to: "/docs/clients", label: "Choose an MCP client" },
          { to: "/docs/credentials", label: "Compare Google credentials and access modes" },
          { to: "/docs/commands", label: "Browse the command reference" },
        ]}
      />
    </article>
  );
}
