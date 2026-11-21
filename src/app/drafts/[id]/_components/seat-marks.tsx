/** Marks a bot's seat where a person's shows here or away. */
export function BotMark() {
  return (
    <span
      title="bot"
      aria-label="bot"
      className="inline-block h-2 w-2 shrink-0 rounded-sm bg-violet-500"
    />
  );
}

export function Presence(props: { away: boolean }) {
  return (
    <span
      title={props.away ? "away" : "here"}
      aria-label={props.away ? "away" : "here"}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${props.away ? "bg-muted" : "bg-green-500"}`}
    />
  );
}
