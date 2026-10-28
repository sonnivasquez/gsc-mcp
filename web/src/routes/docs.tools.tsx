import { createFileRoute } from "@tanstack/react-router";
import { H2, Lead, TopicLinks } from "@/components/doc";
import { pageHead } from "@/lib/site";
import { CANONICAL_TOOLS } from "@/lib/tools";

export const Route = createFileRoute("/docs/tools")({ head: () => pageHead({ path: "/docs/tools", title: "MCP tools reference | gsc-mcp", description: "Explore the complete Google Search Console MCP tool catalog and access requirements." }), component: ToolsPage });
function ToolsPage() {
  return <article>
    <h1 className="mt-0 font-display font-semibold tracking-[-0.02em] text-balance text-ink">MCP tools reference</h1>
    <Lead>The server exposes {CANONICAL_TOOLS.length} tools. Call them through your MCP client; they are not terminal commands.</Lead>
    <H2 id="catalog">Tool catalog</H2>
    <p className="mt-3 text-base leading-relaxed text-ink-soft">The kind describes the main operation, not every data source: for example, change impact can query Google even though it is classified as local. Capabilities works offline. Fetch tools request authorized site resources; write tools require full access and explicit invocation. Indexing API notifications have restricted eligibility.</p>
    <div tabIndex={0} role="region" aria-label="MCP tools: scrollable table" className="mt-3 overflow-x-auto rounded-[var(--ds-radius-lg)] border border-line bg-card"><table className="w-full text-left text-base"><thead><tr className="border-b border-line"><th scope="col" className="px-4 py-3 font-semibold text-ink">Tool</th><th scope="col" className="px-4 py-3 font-semibold text-ink">Kind</th><th scope="col" className="px-4 py-3 font-semibold text-ink">Purpose</th></tr></thead><tbody className="divide-y divide-line text-ink-soft">{CANONICAL_TOOLS.map(tool => <tr key={tool.name}><th scope="row" className="px-4 py-3 text-left font-mono text-sm font-normal text-ink">{tool.name}</th><td className="px-4 py-3">{tool.kind}</td><td className="px-4 py-3">{tool.description}</td></tr>)}</tbody></table></div>
    <H2 id="next">Detailed guides</H2><TopicLinks items={[{to:"/docs/audits",label:"Run an on-demand audit"},{to:"/docs/analytics",label:"Query analytics and timelines"},{to:"/docs/history",label:"Manage change history"},{to:"/docs/commands",label:"CLI commands"}]} />
  </article>;
}
