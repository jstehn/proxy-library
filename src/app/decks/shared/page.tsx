import Link from "next/link";
import { readPage } from "@/server/page-instance";
import { LocalTime } from "@/ui/local-time";
import { FORMAT_LABELS } from "../labels";

// Decks → Shared (design doc 21): every deck the playgroup has shared, newest change first.

export default async function SharedDecksPage() {
  const { reads } = await readPage();
  const decks = await reads.decks.sharedDecks();
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Shared decks</h1>
        <p className="text-muted text-sm">
          Decks the playgroup has shared. Open one to read it, try a test hand, see which cards you
          own, and leave a comment.{" "}
          <Link href="/decks" className="underline">
            Your decks
          </Link>
        </p>
      </header>
      {decks.length === 0 ? (
        <p className="text-muted text-sm">
          Nobody has shared a deck yet. Open one of yours and choose &quot;Share with the
          playgroup&quot;.
        </p>
      ) : (
        <ul className="divide-border-subtle flex flex-col divide-y">
          {decks.map((deck) => (
            <li key={deck.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <Link href={`/decks/${deck.id}`} className="font-medium underline">
                {deck.name}
              </Link>
              <span className="text-muted text-sm">
                by {deck.ownerName} · {FORMAT_LABELS[deck.format]} · {deck.cards} cards
                {deck.commanders.length > 0 && ` · led by ${deck.commanders.join(" and ")}`}
              </span>
              <span className="flex-1" />
              <span className="text-muted text-xs">
                {deck.comments > 0 &&
                  `${deck.comments} ${deck.comments === 1 ? "comment" : "comments"} · `}
                changed <LocalTime iso={deck.updatedAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
