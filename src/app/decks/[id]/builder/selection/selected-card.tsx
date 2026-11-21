"use client";
import Link from "next/link";
import { FaceText } from "@/app/_components/card-preview";
import type { PrintingCard } from "@/modules/catalog";
import type { Board, OtherDeckUse, SuggestionCard, SuggestionList } from "@/modules/decks";
import { copiesToTake } from "@/modules/decks/client";
import { type BracketFlag, Cents } from "@/shared/kernel";
import { TAG_LABELS } from "@/app/decks/labels";
import { HiddenOverTarget, SuggestionRow } from "../suggestions/suggestions-panel";
import { ownedWords } from "../derive";
import { CastCurve } from "../cast-curve/cast-curve";
import { countedCopies, type Selection } from "./selection";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";

// The selected card, large and readable, with what you'd add (design doc 14, section 2.2).

const FLAG_LABELS: Readonly<Record<BracketFlag, string>> = {
  gameChanger: "Game Changer",
  landDenial: "Mass land denial",
  extraTurn: "Extra turn",
};

const MISFIT_TEXT = {
  color: "Outside your commander's colors",
  legality: "Not legal in this deck's format",
} as const;

export function SelectedCard(props: {
  selection: Selection;
  detail: PrintingCard | null;
  quantity: number;
  onQuantity: (quantity: number) => void;
  onAdd: (board: Board, amount?: number) => void;
  copyLimit: number | null;
  deckId: number;
  isCommanderDeck: boolean;
  onClose: () => void;
  /** Cards like this one: null until asked for (design doc 20). */
  similar: SuggestionList | "loading" | null;
  onShowSimilar: () => void;
  onSelectSimilar: (card: SuggestionCard) => void;
  /** Your other decks holding it: "loading" until they arrive (task 42). */
  otherDecks: readonly OtherDeckUse[] | "loading";
  /** Take `count` copies out of another deck, so they're free for this one. */
  onTake: (use: OtherDeckUse, count: number) => void;
}) {
  const { selection, detail } = props;
  const inDeck = countedCopies(selection.inDeck);
  const onMaybeboard = selection.inDeck.maybe ?? 0;
  const button =
    "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40 border border-line";

  return (
    <Card
      aria-label={`Selected: ${selection.name}`}
      as="section"
      padding="md"
      stack
      className="bg-background"
    >
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/images/${selection.printingId}/normal/front`}
          alt={selection.name}
          width={488}
          height={680}
          className="bg-surface-raised aspect-[488/680] h-auto w-32 shrink-0 self-start rounded-[4.5%] shadow-md sm:w-48"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2 text-xs">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-semibold">{selection.name}</h3>
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Close the selected card"
              className="text-muted hover:text-foreground"
            >
              ✕
            </button>
          </div>
          {/* The card's printed text, on a dark panel like the card previews. */}
          <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md bg-zinc-900 p-2 text-white">
            {detail === null ? (
              <p className="text-white/60">Loading the card&apos;s text…</p>
            ) : (
              detail.faces.map((face, index) => (
                <FaceText key={index} face={face} isBackFace={index > 0} />
              ))
            )}
          </div>
          <dl className="flex flex-wrap gap-x-3 gap-y-0.5">
            <Fact
              label="You own"
              value={
                selection.owned === 0 ? "none" : ownedWords(selection.owned, selection.ownedReal)
              }
            />
            {selection.priceCents !== null && (
              <Fact label="Price" value={Cents.format(Cents.of(selection.priceCents))} />
            )}
            <Fact
              label="In this deck"
              value={props.copyLimit !== null ? `${inDeck} / ${props.copyLimit}` : String(inDeck)}
            />
            {onMaybeboard > 0 && <Fact label="Maybeboard" value={String(onMaybeboard)} />}
            {selection.owned > 0 && selection.otherDecks > 0 && (
              <Fact label="Free" value={String(selection.free)} />
            )}
          </dl>
          {selection.otherDecks > 0 && (
            <OtherDecks
              uses={props.otherDecks}
              // Copies this deck wants free: what it holds, or what you're about to add.
              wanted={inDeck > 0 ? inDeck : props.quantity}
              free={selection.free}
              onTake={props.onTake}
            />
          )}
          {selection.tags.length > 0 && (
            <ul aria-label="Roles" className="flex flex-wrap gap-1">
              {selection.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] text-sky-900 dark:bg-sky-950 dark:text-sky-200"
                >
                  {TAG_LABELS[tag]}
                </li>
              ))}
            </ul>
          )}
          {selection.bracketFlags.length > 0 && (
            <ul aria-label="Bracket" className="flex flex-wrap gap-1">
              {selection.bracketFlags.map((flag) => (
                <li
                  key={flag}
                  className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] text-violet-900 dark:bg-violet-950 dark:text-violet-200"
                >
                  {FLAG_LABELS[flag]}
                </li>
              ))}
            </ul>
          )}
          {selection.misfit && <p className="text-warning-text">{MISFIT_TEXT[selection.misfit]}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="How many to add">
          <button
            type="button"
            className="border-line h-8 w-8 rounded-md border"
            onClick={() => props.onQuantity(Math.max(1, props.quantity - 1))}
            aria-label="One fewer to add"
          >
            −
          </button>
          <span className="w-8 text-center tabular-nums" aria-live="polite">
            {props.quantity}
          </span>
          <button
            type="button"
            className="border-line h-8 w-8 rounded-md border"
            onClick={() => props.onQuantity(Math.min(99, props.quantity + 1))}
            aria-label="One more to add"
          >
            +
          </button>
        </div>
        <button
          type="button"
          onClick={() => props.onAdd("main")}
          className={`${button} border-accent bg-accent text-accent-foreground`}
        >
          Add to deck
        </button>
        {props.copyLimit === 4 && inDeck < 4 && (
          <Button type="button" onClick={() => props.onAdd("main", 4 - inDeck)} variant="secondary">
            Fill to 4
          </Button>
        )}
        <Button type="button" onClick={() => props.onAdd("side")} variant="secondary">
          Sideboard
        </Button>
        <Button
          type="button"
          onClick={() => props.onAdd("maybe")}

          title="Keep it with the deck without counting it (the maybeboard)"
          variant="secondary"
        >
          Maybe
        </Button>
        {props.isCommanderDeck && (
          <Button type="button" onClick={() => props.onAdd("commander")} variant="secondary">
            Make commander
          </Button>
        )}
      </div>
      {props.copyLimit !== null && inDeck + props.quantity > props.copyLimit && (
        <p className="text-warning-text text-xs">
          Adding {props.quantity} puts this card at {inDeck + props.quantity} copies (format limit
          is {props.copyLimit}). You can still add it and adjust later.
        </p>
      )}
      {selection.owned === 0 ? (
        <p className="text-warning-text text-xs">
          You don&apos;t own this card. Add it and the deck marks it short; then{" "}
          <Link href={`/singles/list?deck=${props.deckId}`} className="underline">
            buy what it&apos;s short
          </Link>{" "}
          when you&apos;re done.
        </p>
      ) : (
        props.quantity > selection.owned && (
          <p className="text-warning-text text-xs">
            That&apos;s more than you own ({selection.owned}). You can add them; the deck marks it.
          </p>
        )
      )}
      <CastCurve key={selection.oracleId} deckId={props.deckId} card={selection.name} />
      <div className="flex flex-col gap-1 text-sm">
        {props.similar === null ? (
          <button
            type="button"
            onClick={props.onShowSimilar}
            className="self-start text-xs underline"
          >
            Cards like this
          </button>
        ) : props.similar === "loading" ? (
          <p className="text-muted text-xs">Looking for cards like this…</p>
        ) : props.similar.owned.length + props.similar.store.length === 0 ? (
          <p className="text-muted text-xs">Nothing like it in your collection or the store.</p>
        ) : (
          <>
            <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
              Cards like this
            </h4>
            <HiddenOverTarget count={props.similar.hiddenOverTarget} />
            <ul aria-label="Cards like this" className="flex flex-col">
              {[...props.similar.owned, ...props.similar.store].map((suggestion) => (
                <SuggestionRow
                  key={`${suggestion.card.pool}-${suggestion.card.oracleId}`}
                  suggestion={suggestion}
                  onSelect={props.onSelectSimilar}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}

/** Your other decks holding the card, each with a button to take its copies (task 42). */
function OtherDecks(props: {
  uses: readonly OtherDeckUse[] | "loading";
  wanted: number;
  free: number;
  onTake: (use: OtherDeckUse, count: number) => void;
}) {
  if (props.uses === "loading") return <p className="text-muted">Finding your other decks…</p>;
  return (
    <div>
      <p className="text-muted">Also in your other decks:</p>
      <ul aria-label="Other decks using it" className="mt-1 flex flex-col gap-1">
        {props.uses.map((use) => {
          const count = copiesToTake(props.wanted, props.free, use.available);
          return (
            <li key={use.deckId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={`/decks/${use.deckId}`} className="font-medium underline">
                {use.name}
              </Link>
              <span className="text-muted tabular-nums">
                {use.quantity === use.available
                  ? `has ${use.quantity}`
                  : use.available === 0
                    ? "its commander"
                    : `has ${use.quantity} (${use.quantity - use.available} as commander)`}
              </span>
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => props.onTake(use, count)}
                  className="border-line rounded-md border px-2 py-0.5"
                >
                  Take {count}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Fact(props: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt className="text-muted">{props.label}</dt>
      <dd className="font-medium tabular-nums">{props.value}</dd>
    </div>
  );
}
