import type { ReactNode } from "react";
import { useId } from "react";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

export function H2({
  id,
  children,
  step,
}: {
  id: string;
  children: ReactNode;
  step?: number;
}) {
  return (
    <h2 id={id} tabIndex={-1} className="docs-section-heading">
      {step !== undefined && <span className="docs-step-number">{step}</span>}
      <a href={`#${id}`} className="docs-heading-anchor">
        {children}
      </a>
    </h2>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="docs-lead">{children}</p>;
}

export function Note({
  tone,
  label,
  children,
  className,
}: {
  tone: "warn" | "info";
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      aria-label={label}
      className={cn(
        "mt-4 rounded-[var(--ds-radius-md)] border px-4 py-3 text-sm leading-relaxed",
        tone === "warn"
          ? "border-warn-line bg-warn-bg text-warn-ink"
          : "border-cobalt/30 bg-cobalt-wash text-ink",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CmdBlock({
  title,
  command,
  copyLabel,
}: {
  title: string;
  command: string;
  copyLabel: string;
}) {
  const rawId = useId();
  const codeId = `cmd-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <div className="docs-command-panel">
      <div className="docs-command-heading">
        <p className="docs-command-title">{title}</p>
        <CopyButton
          text={command}
          label={copyLabel}
          targetId={codeId}
          className="docs-command-copy border-panel-line bg-transparent text-bright hover:bg-bright/10 hover:text-bright"
        />
      </div>
      <pre
        tabIndex={0}
        role="group"
        aria-label={`${title}: scrollable code`}
        className="docs-command-pre"
      >
        <code id={codeId} tabIndex={-1}>
          {command}
        </code>
      </pre>
    </div>
  );
}

export function TopicLinks({ items }: { items: readonly { to: string; label: string }[] }) {
  return (
    <ul className="mt-4 space-y-2 text-sm">
      {items.map((item) => (
        <li key={item.to}>
          <a
            href={item.to}
            className="font-medium text-cobalt-deep underline decoration-cobalt/40 underline-offset-4 hover:text-cobalt hover:decoration-cobalt"
          >
            {item.label} →
          </a>
        </li>
      ))}
    </ul>
  );
}
