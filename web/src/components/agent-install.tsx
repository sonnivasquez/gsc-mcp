import { CmdBlock } from "@/components/doc";
import { INSTALL_PROMPT } from "@/lib/install-prompt";

export function AgentInstall({ dark = false }: { dark?: boolean }) {
  return (
    <div className="mt-4 min-w-0">
      <p className={`mb-4 text-sm leading-relaxed ${dark ? "text-bright/80" : "text-ink-soft"}`}>
        Copy this prompt into your agent to install the package and connect your
        MCP client. Complete Google sign-in yourself in the browser.
      </p>
      <CmdBlock title="Install with your AI agent" command={INSTALL_PROMPT} copyLabel="Copy installation prompt" />
    </div>
  );
}
