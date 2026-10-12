import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CLIENTS, MAINTAINER, PINNED_SPEC, PKG_NAME, TOKEN_DIR } from "@/lib/site";

/** Supported client names from the product's own client list. */
const NAMED_CLIENTS = CLIENTS.filter(
  (client) => client.kind !== "generic" && client.kind !== "print",
).map((client) => client.label);

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
}

interface HomeFaq {
  question: string;
  answer: ReactNode;
  /**
   * Plain-text rendering of `answer`, required by the FAQPage JSON-LD.
   * Links become their path in parentheses so the structured answer stays
   * readable without markup. Kept beside `answer` on purpose: Google
   * penalises schema that promises content the page does not show.
   */
  answerText: string;
}

export const FAQS: readonly HomeFaq[] = [
  {
    question: "What is gsc-mcp?",
    answer: (
      <p>
        A local MCP server that connects your Search Console data to the AI
        assistant you already use. It runs on your machine and talks to your
        assistant&apos;s client over a local connection — this website never
        runs your queries.
      </p>
    ),
    answerText:
      "A local MCP server that connects your Search Console data to the AI assistant you already use. It runs on your machine and talks to your assistant's client over a local connection — this website never runs your queries.",
  },
  {
    question: "Which assistants can I connect?",
    answer: (
      <p>
        {joinNames(NAMED_CLIENTS)}, and any other client that connects to a
        local MCP server. See{" "}
        <Link
          to="/docs/clients"
          className="font-semibold text-cobalt-deep underline decoration-cobalt decoration-2 underline-offset-4 hover:text-cobalt"
        >
          client setup
        </Link>{" "}
        for the exact steps per client.
      </p>
    ),
    answerText: `${joinNames(NAMED_CLIENTS)}, and any other client that connects to a local MCP server. See client setup (/docs/clients) for the exact steps per client.`,
  },
  {
    question: "Do I need Google credentials?",
    answer: <p>You need a Google account with access to your Search Console property. Quick Connect uses Google sign-in for read-only access. Full access requires your own OAuth client or service account. Follow the <Link to="/docs/credentials" className="home-text-link">credentials guide</Link> for your chosen connection.</p>,
    answerText:
      "You need a Google account with access to your Search Console property. Quick Connect uses Google sign-in for read-only access. Full access requires your own OAuth client or service account. Follow the credentials guide (/docs/credentials) for your chosen connection.",
  },
  {
    question: "Is gsc-mcp free?",
    answer: <p>The code is open source under Apache-2.0, with no gsc-mcp subscription. Your AI client or provider may charge separately.</p>,
    answerText:
      "The code is open source under Apache-2.0, with no gsc-mcp subscription. Your AI client or provider may charge separately.",
  },
  {
    question: "What permissions does it request?",
    answer: <p>Read-only access is the default: it can read Search Console data and inspect URLs. Full access also enables sitemap changes and eligible Indexing API notifications. It does not request Gmail, Drive, or Analytics access. Review <a href="/docs/credentials#scopes" className="home-text-link">access modes and permissions</a> before enabling writes.</p>,
    answerText:
      "Read-only access is the default: it can read Search Console data and inspect URLs. Full access also enables sitemap changes and eligible Indexing API notifications. It does not request Gmail, Drive, or Analytics access. Review access modes and permissions (/docs/credentials#scopes) before enabling writes.",
  },
  {
    question: "Do credentials stay local?",
    answer: (
      <p>
        Tokens are cached in{" "}
        <code className="font-mono text-sm text-ink">{TOKEN_DIR}</code> on
        your machine and sent to Google for authentication. Your MCP client and its AI provider see the tool results
        used to answer your questions — <em>local</em> means no backend of
        ours, not invisible answers.
      </p>
    ),
    answerText: `Tokens are cached in ${TOKEN_DIR} on your machine and sent to Google for authentication. Your MCP client and its AI provider see the tool results used to answer your questions — local means no backend of ours, not invisible answers.`,
  },
  {
    question: "Does inspecting a URL guarantee indexing?",
    answer: (
      <p>
        No. The server reports Google&apos;s indexing state for a URL and the
        property sitemaps that include it. Inspecting a URL does not request
        indexing and never guarantees it.
      </p>
    ),
    answerText:
      "No. The server reports Google's indexing state for a URL and the property sitemaps that include it. Inspecting a URL does not request indexing and never guarantees it.",
  },
  {
    question: "How do I install and update the MCP?",
    answer: (
      <p>
        Run <code>npm install -g {PKG_NAME}</code>, then <code>gsc setup</code>.
        Run the install command again — or <code>gsc update</code> (
        <code>gsc update --check</code> only compares versions) — to update:
        updates never break a working install, and major changes migrate automatically
        with a backup. After updating, check <code>gsc --version</code> and restart
        your MCP client. To stay on a version or roll back, pin it (
        <code>npm install -g {PINNED_SPEC}</code>). Updating or uninstalling never
        touches your Google tokens, profiles, or client configurations. Maintained by {MAINTAINER.name} (
        <a
          href={MAINTAINER.site}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-cobalt-deep underline decoration-cobalt decoration-2 underline-offset-4 hover:text-cobalt"
        >
          sonnivasquez.com
        </a>
        ).
      </p>
    ),
    answerText: `Run npm install -g ${PKG_NAME}, then gsc setup. Run the install command again — or gsc update (gsc update --check only compares versions) — to update: updates never break a working install, and major changes migrate automatically with a backup. After updating, check gsc --version and restart your MCP client. To stay on a version or roll back, pin it (npm install -g ${PINNED_SPEC}). Updating or uninstalling never touches your Google tokens, profiles, or client configurations. Maintained by ${MAINTAINER.name} (${MAINTAINER.site.replace("https://", "")}).`,
  },
];

/**
 * Home-only FAQ: native details/summary rows, the first one open. No
 * dependency, native keyboard behavior, answers drawn only from the docs.
 */
export function HomeFaq() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6"
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <h2
            id="faq-heading"
            className="font-display text-3xl font-semibold tracking-[-0.02em] text-balance text-ink sm:text-4xl"
          >
            Questions before you connect.
          </h2>
          <p className="mt-3 max-w-md text-base leading-relaxed text-ink-soft">
            Short answers from the docs. Longer versions live in the{" "}
            <Link
              to="/docs"
              className="font-semibold text-cobalt-deep underline decoration-cobalt decoration-2 underline-offset-4 hover:text-cobalt"
            >
              setup guide
            </Link>
            .
          </p>
        </div>
        <div className="lg:col-span-8">
          <div>
            {FAQS.map((item, index) => (
              <details
                key={item.question}
                name="home-faq"
                open={index === 0}
                className="home-faq-item border-b border-line last:border-b-0"
              >
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-4 text-base font-semibold text-ink">
                  {item.question}
                  <span
                    aria-hidden="true"
                    className="home-faq-icon font-mono text-lg leading-none text-cobalt"
                  />
                </summary>
                <div className="pr-8 pb-5 text-sm leading-relaxed text-ink-soft [&_a]:underline-offset-4">
                  {item.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
