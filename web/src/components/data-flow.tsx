import { ArrowDown, ArrowRight, Lock, MonitorDown, ScanSearch, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CANONICAL_TOOLS } from "@/lib/tools";

interface FlowNode {
  icon: ReactNode;
  name: string;
  detail: string;
}

/**
 * The factual data path, drawn as geometry. Four stations, one direction:
 * Search Console data travels from Google to the local MCP server, into your
 * MCP client, and on to that client's AI provider. Tokens never leave the
 * machine; responses do.
 */
const NODES: readonly FlowNode[] = [
  {
    icon: <ScanSearch aria-hidden="true" className="size-4" />,
    name: "Google Search Console API",
    detail: "Your properties, queried from this machine",
  },
  {
    icon: <MonitorDown aria-hidden="true" className="size-4" />,
    name: "Local MCP server",
    detail: `${CANONICAL_TOOLS.length} gsc_* tools over stdio · read-only by default`,
  },
  {
    icon: <ArrowRight aria-hidden="true" className="size-4" />,
    name: "Your MCP client",
    detail: "Desktop · Code · Cursor · Codex · generic",
  },
  {
    icon: <Sparkles aria-hidden="true" className="size-4" />,
    name: "The client's AI provider",
    detail: "Sees tool responses to draft answers",
  },
];

export function DataFlowDiagram({ compact = false }: { compact?: boolean }) {
  return (
    <figure
      aria-label="Where your data travels"
      className={cn(
        "overflow-hidden rounded-2xl border bg-card",
        compact ? "border-line" : "border-line-strong",
      )}
    >
      <ol
        className={cn(
          "grid",
          compact
            ? "grid-cols-1 divide-y divide-line"
            : "grid-cols-1 divide-y divide-line md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] md:divide-y-0 md:items-stretch",
        )}
      >
        {NODES.map((node, index) => (
          <FlowStation key={node.name} node={node} index={index} compact={compact} />
        ))}
      </ol>
      <figcaption className="flex items-start gap-2 border-t border-line bg-paper px-4 py-3 text-sm leading-relaxed text-ink-soft">
        <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-cobalt-deep" />
        <span>
          Tokens stay on this machine in <code className="font-mono text-xs text-ink">~/.gsc-mcp/</code> (dir{" "}
          <span className="tnum font-mono text-xs">0700</span>, file{" "}
          <span className="tnum font-mono text-xs">0600</span>). Tool responses travel the whole chain —{" "}
          <em>local</em> means no backend of ours, not invisible answers.
        </span>
      </figcaption>
    </figure>
  );
}

function FlowStation({
  node,
  index,
  compact,
}: {
  node: FlowNode;
  index: number;
  compact: boolean;
}) {
  return (
    <>
      {index > 0 && !compact ? (
        <li
          aria-hidden="true"
          className="hidden items-center justify-center px-1 text-cobalt md:flex"
        >
          <ArrowRight className="size-5" />
        </li>
      ) : null}
      {index > 0 && compact ? (
        <li aria-hidden="true" className="flex items-center justify-start px-4 py-1 text-cobalt">
          <ArrowDown className="size-4" />
        </li>
      ) : null}
      <li className="flex items-start gap-3 px-4 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-cobalt-wash text-cobalt-deep">
          {node.icon}
        </span>
        <span>
          <span className="block font-mono text-sm font-semibold text-ink">
            <span aria-hidden="true" className="tnum mr-2 text-ink-faint">
              {String(index + 1).padStart(2, "0")}
            </span>
            {node.name}
          </span>
          <span className="mt-1 block text-sm leading-snug text-ink-soft">{node.detail}</span>
        </span>
      </li>
    </>
  );
}
