import { Link, createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/terms")({
  head: () =>
    pageHead({
      path: "/terms",
      title: "Terms of use — gsc-mcp Google Search Console MCP site",
      description:
        "Terms for the gsc-mcp site and the local open-source software it documents: license, authorized use, your responsibilities, Google limits, and contacts.",
    }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12 [overflow-wrap:anywhere]">
      <p className="font-mono text-xs tracking-[0.14em] text-cobalt-deep">TERMS</p>
      <h1 className="mt-2 font-display text-[length:var(--ds-type-page)] font-semibold tracking-[-0.02em] text-balance text-ink">
        Terms of use
      </h1>
      <p className="mt-3 leading-relaxed text-ink-soft">
        These terms cover this documentation site and the local open-source
        software it describes. There is no hosted service, no product backend,
        and no account: the server runs on your own machine.
      </p>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        Software license
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft [overflow-wrap:anywhere]">
        The software is licensed under Apache-2.0 (see{" "}
        <code className="font-mono text-sm">LICENSE</code>). Copyright Sonni
        Vasquez. The license governs your software rights, warranty, and
        liability; this page does not change it.
      </p>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        Authorized, lawful use
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
        <li>
          Use the software only with Search Console properties you are
          authorized to access — your own, or where access was explicitly
          granted to you.
        </li>
        <li>
          Use it lawfully and only through authorized access. Do not circumvent
          Google&rsquo;s or your client&rsquo;s access controls.
        </li>
      </ul>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        Your responsibilities
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
        <li>
          Protect your credentials. The cached OAuth token lives in{" "}
          <code className="font-mono text-sm">~/.gsc-mcp/</code> (or{" "}
          <code className="font-mono text-sm">GSC_DATA_DIR</code>, directory{" "}
          <code className="font-mono text-sm">0700</code>, file{" "}
          <code className="font-mono text-sm">0600</code>); credential files
          you supply yourself (<code className="font-mono text-sm">--secrets</code>,{" "}
          <code className="font-mono text-sm">--key-file</code>) live
          wherever you put them — protect those paths too. Anyone who can read
          these files can act as you at Google.
        </li>
        <li>
          Your MCP client and its AI provider see tool responses. Choose
          clients whose policies you accept before querying sensitive
          properties.
        </li>
        <li>
          <code className="font-mono text-sm">auth logout</code> only clears
          local state; <code className="font-mono text-sm">auth revoke --yes</code>{" "}
          revokes at Google too. Removing the client config never revokes the
          grant by itself.
        </li>
      </ul>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        Google services and limits
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
        <li>
          Search Console and Indexing API use is subject to Google&rsquo;s own
          terms and data rules:{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt"
          >
            Google API Services User Data Policy
          </a>
          . This page claims no Google verification or approval.
        </li>
        <li>
          Inspection results and sitemap or URL submissions never guarantee
          crawling, indexing, or ranking.
        </li>
        <li>
          Reported <code className="font-mono text-sm">position</code> is an
          impression-weighted average, not a rank tracker. A traffic change
          overlapping an update window shows timing only, never cause.
        </li>
        <li>
          Indexing API notifications are limited to eligible types, and
          Google&rsquo;s quotas apply.
        </li>
      </ul>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        Privacy
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        Where tokens, profiles, responses, and exports live, and who sees them:{" "}
        <Link
          to="/privacy"
          className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt"
        >
          → /privacy
        </Link>
      </p>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        No guarantees
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
        <li>
          No service-level, uptime, support-response, or outcome guarantees. No
          measured SEO or conversion results are promised.
        </li>
      </ul>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        Changes
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        This page may be revised; material changes update the revision date
        below. Last revised 2026-10-06. These terms apply to use of this
        site and the software it documents.
      </p>

      <h2 className="mt-10 font-display text-[length:var(--ds-type-heading)] font-semibold tracking-[-0.01em] text-ink">
        Contact
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft [overflow-wrap:anywhere]">
        Maintainer: Sonni Vasquez —{" "}
        <a
          href="https://sonnivasquez.com"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt"
        >
          sonnivasquez.com
        </a>{" "}
        ·{" "}
        <a
          href="https://github.com/sonnivasquez"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-cobalt-deep underline underline-offset-4 hover:text-cobalt"
        >
          github.com/sonnivasquez
        </a>
        . No additional support email is published on this page.
      </p>
    </div>
  );
}
