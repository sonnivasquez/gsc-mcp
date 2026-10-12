import { Check, CircleUserRound } from "lucide-react";
import { ClientLogo } from "@/components/client-logo";
import { ConversationStream } from "@/components/conversation-stream";
import { HOME_EXAMPLES } from "@/components/home-example-data";
import { CopyButton } from "@/components/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableScrollHint } from "@/components/table-scroll-hint";
import { useConversationMotion } from "@/components/use-conversation-motion";
import { EXAMPLE_DOMAIN_PROPERTY, EXAMPLE_URL_PROPERTY } from "@/lib/site";

export interface HomeJob {
  id: string;
  /** Short label for the conversation's question selector. */
  tab?: string;
  /** The concrete question, in the visitor's own words. */
  question: string;
  /** Copyable prompt template. */
  prompt?: string;
  /** What the server can inspect for this job. */
  inspects: string;
  /** The evidence behind the answer, and its honest limit. */
  evidence: string;
}

/**
 * The homepage jobs share prompts and evidence with the use-case examples.
 */
export const HOME_JOBS = [
  {
    id: "traffic",
    tab: "Traffic drops",
    question: "Did my traffic really drop — or just move?",
    prompt: `For ${EXAMPLE_DOMAIN_PROPERTY}, compare clicks and impressions for the last 28 days against the previous 28 days, split by page and query. Show totals, the timeline, and the coverage each answer is based on. If a confirmed Google update overlaps the window, note it as timing only, never as the cause. Replace the example property with your exact Search Console property.`,
    inspects:
      "Period and segment comparisons of clicks and impressions, plus which confirmed Google updates overlap the window.",
    evidence:
      "Each comparison returns its date window and coverage; an overlapping update is timing only, never proof of cause.",
  },
  {
    id: "opportunities",
    tab: "Opportunities",
    question: "Which searches already show me but rarely earn the click?",
    prompt: `For ${EXAMPLE_DOMAIN_PROPERTY} over the last 28 days, find queries with high impressions but low click-through rates sitting around positions 5 to 20. Show clicks, impressions, click-through rate, and position for each row, plus the coverage behind it. Replace the example property with your exact Search Console property.`,
    inspects:
      "High-impression, low-CTR queries and striking-distance positions across your pages.",
    evidence:
      "Position is an impression-weighted average, not a rank tracker — read it as direction, not rank.",
  },
  {
    id: "indexing",
    tab: "Indexing",
    question: "Is this URL indexed, and what does Google report about it?",
    prompt: `For ${EXAMPLE_DOMAIN_PROPERTY}, check whether ${EXAMPLE_URL_PROPERTY} is indexed, report its coverage state, and list the sitemaps that include it. Replace the example property and URL with your own.`,
    inspects:
      "Google's reported indexing state and the property sitemaps.",
    evidence:
      "Shows Google's reported status; inspecting a URL does not request or guarantee indexing.",
  },
  {
    id: "reporting",
    tab: "Reports",
    prompt: `For ${EXAMPLE_DOMAIN_PROPERTY}, generate a weekly Markdown report comparing the last 7 days with the previous period. Include totals, page and query movers, opportunities, and coverage limitations. Return the report without saving a file. Replace the example property with your exact Search Console property.`,
    question: "Can I get a weekly report I can cite?",
    inspects:
      "A server-built Search Console report — totals, movers, opportunities — for a 7-day window against the previous period.",
    evidence:
      "Server-generated Markdown export with a limitations section. Review the returned coverage before using it.",
  },
  {
    id: "sitemaps",
    tab: "Sitemaps",
    question: "Which sitemaps are registered, and do they have errors?",
    prompt: `For ${EXAMPLE_DOMAIN_PROPERTY}, list the registered sitemaps and their reported errors and warnings. Keep this read-only: do not submit or change anything. Replace the example property with your exact Search Console property.`,
    inspects: "The sitemaps registered for your property and Google's reported errors and warnings.",
    evidence: "Listing sitemaps is read-only. A submitted sitemap is not proof that its pages are indexed.",
  },
  {
    id: "automation",
    tab: "Automation",
    question: "Can I submit my updated sitemap from my agent?",
    prompt: `For ${EXAMPLE_DOMAIN_PROPERTY}, show the sitemap submission you would make for https://example.com/sitemap.xml. Require full access and property permissions. Ask for my confirmation before submitting it. Replace the example property and sitemap with your own.`,
    inspects: "A sitemap submission through Search Console with full access.",
    evidence: "Sitemap submission requires full access and property permissions. It does not guarantee crawling or indexing.",
  },
] as const satisfies readonly HomeJob[];

/** A bounded, local demo. Preset questions show illustrative evidence only. */
export function QuestionLibrary({
  id = "questions",
  value,
  onValueChange,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const job = HOME_JOBS.find((entry) => entry.id === value) ?? HOME_JOBS[0];
  const example = HOME_EXAMPLES.find((entry) => entry.id === job.id) ?? HOME_EXAMPLES[0];
  const motion = useConversationMotion(job.id, example.answer);

  return (
    <div id={id} className="scroll-mt-20 home-demo-layout">
      <div className="home-demo-intro">
        <h2>See a question become evidence.</h2>
        <p>Choose a question and explore a sample answer from your agent.</p>
        <p className="home-demo-note">Illustrative data for example.com. This demo makes no Google or AI calls.</p>
      </div>
      <Tabs value={job.id} onValueChange={onValueChange} className="home-demo home-underline-tabs">
        <div className="home-demo-toolbar">
          <TabsList aria-label="Choose a use case">
            {HOME_EXAMPLES.map((entry) => <TabsTrigger key={entry.id} value={entry.id}>{HOME_JOBS.find((item) => item.id === entry.id)?.tab}</TabsTrigger>)}
          </TabsList>
          <span className="home-demo-sample">Sample conversation</span>
        </div>
        <TabsContent value={job.id} className="home-demo-panel">
        <div ref={motion.ref} className="home-demo-thread" data-chat-phase={motion.phase}>
          <div className="home-demo-user">
            <span className="home-demo-speaker"><CircleUserRound aria-hidden="true" />You</span>
            <p data-chat-step="prompt">{job.question}</p>
          </div>
          <div className="home-demo-answer" aria-live="polite" aria-atomic="true">
              <span className="home-demo-speaker"><ClientLogo kind={example.clientKind} />{example.client}<span className="home-example-label">Sample answer</span></span>
              <p className="home-demo-answer-intro"><ConversationStream text={example.answer} characters={motion.characters} streaming={motion.phase === "streaming"} /></p>
              <div className="home-tool-call" data-chat-step="tool"><span className="home-tool-check"><Check aria-hidden="true" className="size-3" /></span><code>{example.tool}</code><span className="home-example-label">Example tool result</span></div>
              <div className={`home-table-scroll ${example.columns.length === 2 ? "home-table-fields" : ""}`} tabIndex={0} role="region" aria-label="Sample answer data, scrollable table">
                <table>
                  <caption className="sr-only">Illustrative {example.label.toLowerCase()} data for example.com, not a live query.</caption>
                  <thead><tr>{example.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
                  <tbody>{example.rows.map((row) => <tr key={row[0]} data-chat-step="row">{row.map((cell, index) => index === 0 ? <th key={index} scope="row">{cell}</th> : <td key={index} className={cell.startsWith("+") ? "home-positive" : undefined}>{cell}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <TableScrollHint />
              <p className="home-demo-evidence">{job.evidence}</p>
          </div>
        </div>
        <div className="home-demo-footer">
          <p>Paste this question into your agent, then replace the example property with yours.</p>
          <CopyButton text={job.prompt ?? ""} label="Copy question for your agent" />
        </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
