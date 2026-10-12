import { AlertTriangle, Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  text: string;
  label?: string;
  /** Element id whose contents get selected when the clipboard rejects the write. */
  targetId?: string;
  className?: string;
}

type CopyStatus = "idle" | "copied" | "failed";

const FEEDBACK: Record<CopyStatus, string> = {
  idle: "Copy",
  copied: "Copied to clipboard",
  failed: "Copy blocked — text selected, press Ctrl+C or ⌘C",
};

/**
 * Copy with honest feedback. Success is announced only after the write
 * resolves; when the clipboard API and the execCommand fallback both fail,
 * the source text is selected instead and the user gets manual-copy guidance.
 */
export function CopyButton({
  text,
  label = "Copy to clipboard",
  targetId,
  className,
}: CopyButtonProps) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<number | undefined>(undefined);
  const feedbackId = useId();

  useEffect(() => {
    return () => clearTimeout(timer.current);
  }, []);

  function selectTarget(): boolean {
    if (!targetId) return false;
    const node = document.getElementById(targetId);
    if (!node) return false;
    // Reveal a collapsed template before selecting it for manual copying.
    const disclosure = node.closest("details");
    if (disclosure) disclosure.open = true;
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    const focusable = node as HTMLElement;
    if (typeof focusable.focus === "function") focusable.focus();
    return true;
  }

  function settle(next: CopyStatus) {
    setStatus(next);
    clearTimeout(timer.current);
    // Recovery must stay available while the user copies the selected text.
    if (next === "copied") {
      timer.current = window.setTimeout(() => setStatus("idle"), 4000);
    }
  }

  async function handleCopy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        ok = document.execCommand("copy");
        area.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      settle("copied");
    } else {
      selectTarget();
      settle("failed");
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
       <Button
         type="button"
         variant="secondary"
         size="copy"
         onClick={handleCopy}
        aria-label={label}
        aria-describedby={status === "failed" ? feedbackId : undefined}
        className={cn("shrink-0", className)}
      >
        <span aria-hidden="true" className="flex">
          {status === "copied" ? (
            <Check />
          ) : status === "failed" ? (
            <AlertTriangle />
          ) : (
            <Copy />
          )}
        </span>
        <span aria-hidden="true">{status === "copied" ? "Copied" : "Copy"}</span>
      </Button>
      <span role="status" className="sr-only">
        {status === "idle" ? "" : FEEDBACK[status]}
      </span>
      {status === "failed" ? (
        <span
          id={feedbackId}
          className="max-w-56 text-right text-xs leading-snug text-warn-on-dark"
        >
          Clipboard blocked it — the text is selected. Press{" "}
          <kbd className="rounded border border-current px-1 font-mono">Ctrl+C</kbd>{" "}
          or <kbd className="rounded border border-current px-1 font-mono">⌘C</kbd>.
          {!targetId ? <textarea aria-label="Text to copy manually" readOnly value={text} rows={3} className="mt-2 w-full rounded border border-line bg-card p-2 text-left text-ink" ref={(node) => { node?.focus(); node?.select(); }} /> : null}
        </span>
      ) : null}
    </span>
  );
}
