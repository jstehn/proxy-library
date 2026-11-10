import Link from "next/link";
import { notFound } from "next/navigation";
import { printingCards } from "@/modules/catalog";
import {
  deckComments,
  deckForViewer,
  deckText,
  EXPORTERS,
  fingerprint,
  FORMATS,
  type DeckTextLine,
} from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Alert } from "@/ui/form";
import { ManaStylesheet } from "@/ui/mana";
import {
  deleteDeckAction,
  importListAction,
  setUsesRealCardsAction,
  setVisibilityAction,
  updateDeckAction,
} from "../actions";
import { FORMAT_LABELS } from "../labels";
import { loadBuilderDeck } from "./builder/actions";
import { DeckBuilder } from "./builder/deck-builder";
import { DeckComments } from "./comments";
import { EditAsText } from "./edit-as-text";
import { SharedDeckView } from "./shared-view";

const field =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";

export default async function DeckPage(props: PageProps<"/decks/[id]">) {
  const actor = await requireActor();
  const { id } = await props.params;
  const deckId = Number(id);
  if (!Number.isSafeInteger(deckId) || deckId <= 0) notFound();
  const { db, seeds } = getContainer();
  const searchParams = await props.searchParams;

  // The owner gets the builder; anyone else, a shared deck read-only (design doc 21).
  const viewed = await deckForViewer(db, actor.userId, deckId);
  if (viewed === null) notFound();
  const { view } = viewed;
  const { deck } = view;
  const comments = await deckComments(db, deckId);
  const commentSection = (
    <DeckComments
      deckId={deck.id}
      comments={comments}
      viewerId={actor.userId}
      viewerIsAdmin={actor.isAdmin}
      isOwner={viewed.isOwner}
      isShared={viewed.visibility === "shared"}
      asBox={viewed.isOwner}
    />
  );

  if (!viewed.isOwner) {
    const cards = await printingCards(
      db,
      view.lines.map((line) => line.printingId),
    );
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
        <ManaStylesheet />
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{deck.name}</h1>
          <p className="text-sm text-zinc-500">
            {FORMAT_LABELS[deck.format]} · shared by {viewed.ownerName} ·{" "}
            <Link href="/decks/shared" className="underline">
              All shared decks
            </Link>
          </p>
        </header>
        <SharedDeckView
          lines={view.lines}
          rules={view.rules}
          cards={Object.fromEntries(cards)}
          format={deck.format}
          targetBracket={deck.targetBracket}
          seed={seeds.newSeed()}
          ownerName={viewed.ownerName}
          yourCopies={viewed.yourCopies}
          listText={EXPORTERS.names(view.lines)}
        />
        {commentSection}
      </main>
    );
  }

  const builderDeck = await loadBuilderDeck(deckId);
  if (builderDeck === null) notFound();
  // The builder keeps the deck in its own state; a pasted list or new settings start it afresh.
  const builderKey = `${deck.format}|${deck.usesRealCards}|${deck.entries
    .map((entry) => `${entry.board}:${entry.oracleId}:${entry.quantity}`)
    .join(",")}`;

  // The Edit as text box (design doc 23): printings only where pinned, so saving the text
  // unchanged leaves the deck as it was. The fingerprint is of what's stored.
  const textLines: DeckTextLine[] = view.lines.map((line) => ({
    quantity: line.quantity,
    name: line.name,
    board: line.board,
    setCode: line.pinnedPrintingId === null ? null : line.setCode,
    collectorNumber: line.pinnedPrintingId === null ? null : line.collectorNumber,
    finish: line.pinnedFinish,
  }));
  const deckFingerprint = fingerprint(
    view.lines.map((line) => ({
      ...line,
      printingId: line.pinnedPrintingId,
      finish: line.pinnedFinish,
    })),
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <ManaStylesheet />
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{deck.name}</h1>
          <p className="text-sm text-zinc-500">
            {FORMAT_LABELS[deck.format]} ·{" "}
            <a href="#edit-as-text" className="underline">
              Edit as text
            </a>{" "}
            ·{" "}
            <Link href={`/decks/${deck.id}/export`} className="underline">
              Export
            </Link>{" "}
            ·{" "}
            <Link href={`/decks/${deck.id}/print`} className="underline">
              Print proxies
            </Link>{" "}
            ·{" "}
            <Link href={`/singles/list?deck=${deck.id}`} className="underline">
              Buy what it&apos;s short
            </Link>{" "}
            ·{" "}
            <Link href="/decks" className="underline">
              All decks
            </Link>
          </p>
        </div>
        <form action={setVisibilityAction} className="flex items-center gap-2 text-sm">
          <input type="hidden" name="deckId" value={deck.id} />
          <input
            type="hidden"
            name="visibility"
            value={viewed.visibility === "shared" ? "private" : "shared"}
          />
          <span className="text-zinc-500">
            {viewed.visibility === "shared"
              ? "Shared: every player can see it and comment."
              : "Private: only you can see it."}
          </span>
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700"
          >
            {viewed.visibility === "shared" ? "Make private" : "Share with the playgroup"}
          </button>
        </form>
      </header>
      <form action={setUsesRealCardsAction} className="flex flex-wrap items-center gap-2 text-sm">
        <input type="hidden" name="deckId" value={deck.id} />
        <input type="hidden" name="usesRealCards" value={deck.usesRealCards ? "off" : "on"} />
        <span className="text-zinc-500">
          {deck.usesRealCards
            ? "Using your real cards: cards you own for real count as owned here."
            : "Game cards only: cards you own for real don't count here."}
        </span>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700"
        >
          {deck.usesRealCards ? "Stop using my real cards" : "Use my real cards"}
        </button>
      </form>
      {typeof searchParams.error === "string" && <Alert tone="error">{searchParams.error}</Alert>}
      {typeof searchParams.imported === "string" && (
        <Alert tone="success">{searchParams.imported}</Alert>
      )}

      {/* Keyed by the fingerprint, so a saved or changed deck starts the box afresh. */}
      <EditAsText
        key={deckFingerprint}
        deckId={deck.id}
        text={deckText(textLines)}
        fingerprint={deckFingerprint}
      />

      {/* Above the builder: its collection grid loads more as you scroll, so nothing below it
          can be reached (a pasted list is how you add a card you don't own). */}
      <div className="grid items-start gap-3 md:grid-cols-3">
        <details
          open={deck.entries.length === 0}
          className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
        >
          <summary className="cursor-pointer font-medium">Paste a list</summary>
          <form action={importListAction} className="mt-3 flex flex-col gap-2">
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
        </details>
        <details className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <summary className="cursor-pointer font-medium">Deck settings</summary>
          <form action={updateDeckAction} className="mt-3 flex flex-col gap-2">
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
          <details className="mt-2 text-sm">
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
        </details>
        {commentSection}
      </div>

      <DeckBuilder
        key={builderKey}
        deckId={deck.id}
        format={deck.format}
        initialDeck={builderDeck}
        targetBracket={deck.targetBracket}
        seed={seeds.newSeed()}
      />
    </main>
  );
}
