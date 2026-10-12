import { ArrowRight, Check } from "lucide-react";
import { ClientLogo } from "@/components/client-logo";
import { ConversationStream } from "@/components/conversation-stream";
import { HOME_EXAMPLES } from "@/components/home-example-data";
import { HOME_JOBS } from "@/components/home-questions";
import { TableScrollHint } from "@/components/table-scroll-hint";
import { useConversationMotion } from "@/components/use-conversation-motion";
import type { ClientInfo } from "@/lib/site";



function Conversation({ example }: { example: (typeof HOME_EXAMPLES)[number] }) {
  const motion = useConversationMotion(example.id, example.answer);
  return (
    <figure ref={motion.ref} className="home-conversation" data-chat-phase={motion.phase}>
      <figcaption className="home-conversation-header">
        <span className="flex items-center gap-2.5"><ClientLogo kind={example.clientKind satisfies ClientInfo["kind"]} />{example.client}</span>
        <span className="home-example-label">Illustrative example</span>
      </figcaption>
      <p className="home-prompt" data-chat-step="prompt">{example.prompt}</p>
      <p className="home-conversation-answer"><ConversationStream text={example.answer} characters={motion.characters} streaming={motion.phase === "streaming"} /></p>
      <div className="home-tool-call" data-chat-step="tool"><span className="home-tool-check"><Check aria-hidden="true" className="size-3" /></span><code>{example.tool}</code></div>
      <div className={`home-table-scroll ${example.columns.length === 2 ? "home-table-fields" : ""}`} tabIndex={0} role="region" aria-label={`${example.label} example data, scrollable table`}>
        <table>
          <caption className="sr-only">Illustrative {example.label.toLowerCase()} response with sample data, not a live query.</caption>
          <thead><tr>{example.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
          <tbody>{example.rows.map((row) => <tr key={row[0]} data-chat-step="row">{row.map((cell, index) => index === 0 ? <th scope="row" key={index}>{cell}</th> : <td key={index} className={cell.startsWith("+") ? "home-positive" : undefined}>{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <TableScrollHint />
    </figure>
  );
}

export function HomeUseCases({ onSelectQuestion }: { onSelectQuestion: (id: string) => void }) {
  return (
    <section id="use-cases" aria-labelledby="jobs-heading" className="home-container home-use-cases">
      <div className="home-section-heading">
        <p className="home-section-label">Use cases</p>
        <h2 id="jobs-heading">Your Search Console data. Put to work.</h2>
        <p>Go from a question to evidence, inside the assistant you already use.</p>
      </div>
      <div className="home-case-list">
        {HOME_EXAMPLES.map((example, index) => {
          const job = HOME_JOBS.find((entry) => entry.id === example.id);
          return (
            <article key={example.id} className={`home-case ${index % 2 ? "home-case-reverse" : ""}`}>
              <div className="home-case-copy">
                <p className="home-case-label"><example.icon aria-hidden="true" className="size-4" />{example.label}</p>
                <h3>{example.title}</h3>
                <p>{example.description}</p>
                <p className="home-case-evidence">{job?.evidence ?? ("evidence" in example ? example.evidence : undefined)}</p>
                <a className="home-text-link" href={example.to} onClick={example.to === "#questions" ? () => onSelectQuestion(example.id) : undefined}>{example.cta}<ArrowRight aria-hidden="true" className="size-4" /></a>
              </div>
              <Conversation example={example} />
            </article>
          );
        })}
      </div>
      <p className="home-example-note">Examples use sample data for example.com. Your assistant returns the evidence for your own property.</p>
    </section>
  );
}
