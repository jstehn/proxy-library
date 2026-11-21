import Link from "next/link";
import { notFound } from "next/navigation";
import { EXPORTERS, FORMATS, listAndFingerprint } from "@/modules/decks";
import { readPage } from "@/server/page-instance";
import { Alert } from "@/ui/form";
import { ManaStylesheet } from "@/ui/mana";
import { WishForShortForm } from "../../wishlist/wish-forms";
import {
  copyDeckAction,
  deleteDeckAction,
  importListAction,
  setUsesRealCardsAction,
  setVisibilityAction,
  updateDeckAction,
} from "../actions";
import { FORMAT_LABELS } from "../labels";
import { builderDeckFor } from "./builder/builder-deck";
import { DeckBuilder } from "./builder/deck-builder";
import { DeckComments } from "./comments";
import { EditAsText } from "./edit-as-text";
import { PublicLinkControls } from "./public-link-controls";
import { SharedDeckView } from "./shared-view";
import { Button } from "@/ui/button";
import { Input, Select, Textarea } from "@/ui/field";
import { Page } from "@/ui/page";

export default async function DeckPage(props: PageProps<"/decks/[id]">) {
  const { actor, capabilities, reads } = await readPage();
  const { id } = await props.params;
  const deckId = Number(id);
  if (!Number.isSafeInteger(deckId) || deckId <= 0) notFound();
  const searchParams = await props.searchParams;

  // The owner gets the builder; anyone else, a shared deck read-only (design doc 21).
  const viewed = await reads.decks.deckForViewer(actor, deckId);
  if (viewed === null) notFound();
  const { view } = viewed;
  const { deck } = view;
  const comments = await reads.decks.deckComments(actor, deckId);
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
    const shared = await capabilities.deckOverview(actor, {
      deckId: deck.id,
      asViewer: true,
      parts: { printings: true, tokens: true },
    });
    if (!shared.ok) notFound();
    const { printings, tokens, combos } = shared.value;
    return (
      <Page width="7xl" spacing="tight">
        <ManaStylesheet />
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">{deck.name}</h1>
            <p className="text-muted text-sm">
              {FORMAT_LABELS[deck.format]} · shared by {viewed.ownerName} ·{" "}
              <Link href="/decks/shared" className="underline">
                All shared decks
              </Link>
            </p>
          </div>
          <form action={copyDeckAction}>
            <input type="hidden" name="deckId" value={deck.id} />
            <Button type="submit">Copy to my decks</Button>
          </form>
        </header>
        {typeof searchParams.error === "string" && <Alert tone="error">{searchParams.error}</Alert>}
        <SharedDeckView
          lines={view.lines}
          rules={view.rules}
          cards={Object.fromEntries(printings ?? [])}
          format={deck.format}
          targetBracket={deck.targetBracket}
          seed={capabilities.site.newSeed()}
          ownerName={viewed.ownerName}
          yourCopies={viewed.yourCopies}
          listText={EXPORTERS.names(view.lines)}
          grouping={deck.grouping}
          combos={combos}
          headings={deck.headings}
          tokens={[...(tokens ?? [])]}
        />
        {commentSection}
      </Page>
    );
  }

  const builderDeck = await builderDeckFor(capabilities, actor, deckId);
  if (builderDeck === null) notFound();
  // The builder keeps the deck in its own state; a pasted list or new settings start it afresh.
  const builderKey = `${deck.format}|${deck.usesRealCards}|${deck.entries
    .map(
      (entry) =>
        `${entry.board}:${entry.oracleId}:${entry.quantity}:${entry.heading ?? ""}:${entry.note ?? ""}`,
    )
    .join(",")}|${deck.grouping}|${deck.headings.join(",")}`;

  // The Edit as text box (design doc 23): printings only where pinned, so saving the text
  // unchanged leaves the deck as it was. The fingerprint is of what's stored.
  const { list: listText, fingerprint: deckFingerprint } = listAndFingerprint(view);

  return (
    <Page width="7xl" spacing="tight">
      <ManaStylesheet />
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{deck.name}</h1>
          <div className="text-muted text-sm">
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
            · <WishForShortForm deckId={deck.id} label="Wish for what it's short" look="link" /> ·{" "}
            <Link href="/decks" className="underline">
              All decks
            </Link>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <form action={setVisibilityAction} className="flex items-center gap-2 text-sm">
            <input type="hidden" name="deckId" value={deck.id} />
            <input
              type="hidden"
              name="visibility"
              value={viewed.visibility === "shared" ? "private" : "shared"}
            />
            <span className="text-muted">
              {viewed.visibility === "shared"
                ? "Shared: every player can see it and comment."
                : "Private: only you can see it."}
            </span>
            <Button type="submit" variant="secondary" size="sm">
              {viewed.visibility === "shared" ? "Make private" : "Share with the playgroup"}
            </Button>
          </form>
          <PublicLinkControls deckId={deck.id} publicToken={viewed.publicToken} />
        </div>
      </header>
      <form action={setUsesRealCardsAction} className="flex flex-wrap items-center gap-2 text-sm">
        <input type="hidden" name="deckId" value={deck.id} />
        <input type="hidden" name="usesRealCards" value={deck.usesRealCards ? "off" : "on"} />
        <span className="text-muted">
          {deck.usesRealCards
            ? "Using your real cards: cards you own for real count as owned here."
            : "Game cards only: cards you own for real don't count here."}
        </span>
        <Button type="submit" variant="secondary" size="sm">
          {deck.usesRealCards ? "Stop using my real cards" : "Use my real cards"}
        </Button>
      </form>
      {typeof searchParams.error === "string" && <Alert tone="error">{searchParams.error}</Alert>}
      {typeof searchParams.imported === "string" && (
        <Alert tone="success">{searchParams.imported}</Alert>
      )}

      {/* Keyed by the fingerprint, so a saved or changed deck starts the box afresh. */}
      <EditAsText
        key={deckFingerprint}
        deckId={deck.id}
        text={listText}
        fingerprint={deckFingerprint}
      />

      {/* Above the builder: its collection grid loads more as you scroll, so nothing below it
          can be reached (a pasted list is how you add a card you don't own). */}
      <div className="grid items-start gap-3 md:grid-cols-3">
        <details
          open={deck.entries.length === 0}
          className="border-border-subtle rounded-md border p-3"
        >
          <summary className="cursor-pointer font-medium">Paste a list</summary>
          <form action={importListAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="deckId" value={deck.id} />
            <Textarea
              name="list"
              rows={6}
              aria-label="Paste a deck list"
              placeholder={"4 Lightning Bolt\n1 Sol Ring (C21) 263\nSideboard\n2 Duress"}
              className="font-mono"
            />
            <Button variant="secondary" type="submit">
              Add these cards
            </Button>
          </form>
          <p className="text-muted text-xs">
            Cards you don&apos;t own are added too, and show as short.
          </p>
        </details>
        <details className="border-border-subtle rounded-md border p-3">
          <summary className="cursor-pointer font-medium">Deck settings</summary>
          <form action={updateDeckAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="deckId" value={deck.id} />
            <Input name="name" defaultValue={deck.name} aria-label="Deck name" maxLength={60} />
            <Select name="format" defaultValue={deck.format} aria-label="Format">
              {FORMATS.map((format) => (
                <option key={format} value={format}>
                  {FORMAT_LABELS[format]}
                </option>
              ))}
            </Select>
            <Button variant="secondary" type="submit">
              Save
            </Button>
          </form>
          {/* A second click to confirm, so a slip doesn't delete a deck. */}
          <details className="mt-2 text-sm">
            <summary className="text-danger-text cursor-pointer">Delete this deck…</summary>
            <form action={deleteDeckAction} className="mt-2">
              <input type="hidden" name="deckId" value={deck.id} />
              <Button type="submit" variant="danger" size="sm">
                Yes, delete {deck.name}
              </Button>
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
        seed={capabilities.site.newSeed()}
      />
    </Page>
  );
}
