import Link from "next/link";
import { notFound } from "next/navigation";
import { deckView, FORMATS } from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Alert } from "@/ui/form";
import { ManaStylesheet } from "@/ui/mana";
import { deleteDeckAction, importListAction, updateDeckAction } from "../actions";
import { FORMAT_LABELS } from "../labels";
import { loadBuilderDeck } from "./builder/actions";
import { DeckBuilder } from "./builder/deck-builder";

const field =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";

export default async function DeckPage(props: PageProps<"/decks/[id]">) {
  const actor = await requireActor();
  const { id } = await props.params;
  const deckId = Number(id);
  if (!Number.isSafeInteger(deckId) || deckId <= 0) notFound();
  const { db } = getContainer();
  const searchParams = await props.searchParams;

  const view = await deckView(db, actor.userId, deckId);
  const builderDeck = await loadBuilderDeck(deckId);
  if (view === null || builderDeck === null) notFound();
  const { deck } = view;
  // The builder keeps the deck in its own state; a pasted list or new settings start it afresh.
  const builderKey = `${deck.format}|${deck.entries
    .map((entry) => `${entry.board}:${entry.oracleId}:${entry.quantity}`)
    .join(",")}`;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <ManaStylesheet />
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{deck.name}</h1>
          <p className="text-sm text-zinc-500">
            {FORMAT_LABELS[deck.format]} ·{" "}
            <Link href={`/decks/${deck.id}/export`} className="underline">
              Export
            </Link>{" "}
            ·{" "}
            <Link href={`/decks/${deck.id}/print`} className="underline">
              Print proxies
            </Link>{" "}
            ·{" "}
            <Link href="/decks" className="underline">
              All decks
            </Link>
          </p>
        </div>
      </header>
      {typeof searchParams.error === "string" && <Alert tone="error">{searchParams.error}</Alert>}
      {typeof searchParams.imported === "string" && (
        <Alert tone="success">{searchParams.imported}</Alert>
      )}

      <DeckBuilder
        key={builderKey}
        deckId={deck.id}
        format={deck.format}
        initialDeck={builderDeck}
      />

      <div className="grid gap-8 border-t border-zinc-200 pt-6 md:grid-cols-2 dark:border-zinc-800">
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Paste a list</h2>
          <form action={importListAction} className="flex flex-col gap-2">
            <input type="hidden" name="deckId" value={deck.id} />
            <textarea
              name="list"
              rows={6}
              aria-label="Paste a deck list"
              placeholder={"4 Lightning Bolt\n1 Sol Ring (C21) 263\nSideboard\n2 Duress"}
              className={`${field} font-mono`}
            />
            <button type="submit" className={field}>
              Add these cards
            </button>
          </form>
          <p className="text-xs text-zinc-500">
            Cards you don&apos;t own are added too, and show as short.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Deck settings</h2>
          <form action={updateDeckAction} className="flex flex-col gap-2">
            <input type="hidden" name="deckId" value={deck.id} />
            <input
              name="name"
              defaultValue={deck.name}
              aria-label="Deck name"
              maxLength={60}
              className={field}
            />
            <select name="format" defaultValue={deck.format} aria-label="Format" className={field}>
              {FORMATS.map((format) => (
                <option key={format} value={format}>
                  {FORMAT_LABELS[format]}
                </option>
              ))}
            </select>
            <button type="submit" className={field}>
              Save
            </button>
          </form>
          {/* A second click to confirm, so a slip doesn't delete a deck. */}
          <details className="text-sm">
            <summary className="cursor-pointer text-red-700 dark:text-red-400">
              Delete this deck…
            </summary>
            <form action={deleteDeckAction} className="mt-2">
              <input type="hidden" name="deckId" value={deck.id} />
              <button type="submit" className="rounded-md bg-red-700 px-3 py-1 text-white">
                Yes, delete {deck.name}
              </button>
            </form>
          </details>
        </section>
      </div>
    </main>
  );
}
