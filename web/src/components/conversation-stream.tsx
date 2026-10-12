/** Reserve the full text's height; only the visual copy streams, never the accessible copy. */
export function ConversationStream({ text, characters, streaming }: { text: string; characters: number; streaming: boolean }) {
  return (
    <span className="home-stream-text">
      <span className="sr-only">{text}</span>
      <span className="home-stream-reserve" aria-hidden="true">{text}</span>
      <span className="home-stream-output" aria-hidden="true" data-streaming={streaming || undefined}>{Array.from(text).slice(0, characters).join("")}</span>
    </span>
  );
}
