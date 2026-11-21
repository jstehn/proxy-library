"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  BudgetList,
  DeckSuggestions,
  Suggestion,
  SuggestionCard,
  SuggestionList,
} from "@/modules/decks";
import { Cents, THEME_LABELS } from "@/shared/kernel";
import { ManaText } from "@/ui/mana";
import { plural } from "@/modules/decks/client";
import { reasonText, TAG_LABELS } from "@/app/decks/labels";
import { valueOr } from "../answer";
import { budgetAction, suggestionsAction } from "./actions";
import { Button } from "@/ui/button";
import { Input } from "@/ui/field";
import { Card } from "@/ui/card";

// Suggestions (design doc 20, section 5.1): cards for this deck and for the roles it's short of,
// your own first, then the store's; and a shopping list within a budget. Clicking a card selects
// it in the builder, as a grid card does, so it can be read and added.

const WAIT_MILLISECONDS = 600; // let a burst of deck changes settle before asking again

export function SuggestionsPanel(props: {
  deckId: number;
  /** Changes whenever the deck's contents do, so the suggestions follow the deck. */
  deckKey: string;
  onSelect: (card: SuggestionCard) => void;
  onClose: () => void;
}) {
  const { deckId, deckKey } = props;
  const [suggestions, setSuggestions] = useState<DeckSuggestions | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    const timer = setTimeout(() => {
      setLoading(true);
      void suggestionsAction(deckId).then((result) => {
        if (request !== latest.current) return; // the deck changed again meanwhile
        setSuggestions(valueOr(result, null));
        setLoading(false);
      });
    }, WAIT_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [deckId, deckKey]);

  const profile = suggestions?.profile;
  const about = [
    ...(profile?.tribes.map(plural) ?? []),
    ...(profile?.themes.map((theme) => THEME_LABELS[theme]) ?? []),
  ];

  return (
    <Card
      aria-label="Suggestions"
      as="section"
      padding="md"
      className="flex flex-col gap-4 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">Suggestions</h2>
          {profile && (
            <p className="text-muted text-xs">
              {about.length > 0 ? `Builds around ${about.join(", ")}. ` : ""}
              {profile.gaps.length > 0
                ? `Short of ${profile.gaps.map((gap) => TAG_LABELS[gap.tag].toLowerCase()).join(", ")}.`
                : "Every role is at its target."}
            </p>
          )}
        </div>
        <button type="button" onClick={props.onClose} className="text-xs underline">
          Close
        </button>
      </div>

      {suggestions === null ? (
        <p className="text-muted">{loading ? "Looking through the cards…" : "No suggestions."}</p>
      ) : (
        <div className={`flex flex-col gap-4 ${loading ? "opacity-60" : ""}`}>
          <SuggestionSection
            title="For this deck"
            list={suggestions.forDeck}
            onSelect={props.onSelect}
            empty="Nothing in your collection or the store shares this deck's themes yet. Add a commander or a few cards first."
          />
          {suggestions.forRoles.map((role) => (
            <SuggestionSection
              key={role.tag}
              title={`${TAG_LABELS[role.tag]} (${role.count} of ${role.target})`}
              list={role}
              onSelect={props.onSelect}
              empty="Nothing found for this role in the deck's colors."
            />
          ))}
        </div>
      )}

      <BudgetForm deckId={deckId} deckKey={deckKey} onSelect={props.onSelect} />
      <p className="text-muted text-xs">
        To finish the deck as it is:{" "}
        <Link href={`/singles/list?deck=${deckId}`} className="underline">
          buy what it&apos;s short
        </Link>
        . Suggestions are ideas to consider, picked by simple rules from rules text and prices, not
        from other players&apos; decks.
      </p>
    </Card>
  );
}

/** "Hiding 6 cards over your target bracket" (design doc 31), or nothing. */
export function HiddenOverTarget(props: { count: number }) {
  if (props.count === 0) return null;
  return (
    <p className="text-warning-text text-xs">
      Hiding {props.count} {props.count === 1 ? "card" : "cards"} over your target bracket.
    </p>
  );
}

function SuggestionSection(props: {
  title: string;
  list: SuggestionList;
  onSelect: (card: SuggestionCard) => void;
  empty: string;
}) {
  const all = [...props.list.owned, ...props.list.store];
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-muted text-xs font-medium tracking-wide uppercase">{props.title}</h3>
      <HiddenOverTarget count={props.list.hiddenOverTarget} />
      {all.length === 0 ? (
        <p className="text-muted text-xs">{props.empty}</p>
      ) : (
        <ul aria-label={props.title} className="flex flex-col">
          {all.map((suggestion) => (
            <SuggestionRow
              key={`${suggestion.card.pool}-${suggestion.card.oracleId}`}
              suggestion={suggestion}
              onSelect={props.onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function SuggestionRow(props: {
  suggestion: Suggestion;
  onSelect: (card: SuggestionCard) => void;
}) {
  const {
    card,
    reasons,
    rating: { rating, parts: ratingParts },
  } = props.suggestion;
  const reasonWords = reasons.map(reasonText).join(" · ");
  const partsTitle = ratingParts
    .map((p) => `${p.label} (${p.contribution >= 0 ? "+" : ""}${p.contribution.toFixed(2)})`)
    .join(" · ");
  return (
    <li>
      <button
        type="button"
        onClick={() => props.onSelect(card)}
        aria-label={`${card.name}: ${reasonWords}, ${card.pool === "owned" ? `you own ${card.owned}` : `${Cents.format(Cents.of(card.priceCents ?? 0))} in the store`}`}
        className="hover:bg-surface flex w-full items-center gap-2 rounded px-1 py-1 text-left"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/images/${card.printingId}/small/front`}
          alt=""
          loading="lazy"
          className="bg-surface-raised aspect-[146/204] w-9 shrink-0 rounded-[4.5%]"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1">
            <span
              title={partsTitle || `Rating ${rating}/100`}
              className="bg-surface-raised text-foreground shrink-0 rounded px-1 text-[11px] font-medium tabular-nums"
            >
              {rating}
            </span>
            <span className="truncate">{card.name}</span>
            {card.manaCost && (
              <span className="shrink-0 text-xs">
                <ManaText text={card.manaCost} />
              </span>
            )}
          </span>
          <span className="text-muted truncate text-xs">{reasonWords}</span>
        </span>
        <span
          className={`shrink-0 rounded px-1.5 text-xs ${card.pool === "owned" ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" : "tabular-nums"}`}
        >
          {card.pool === "owned"
            ? `You own ${card.owned}`
            : Cents.format(Cents.of(card.priceCents ?? 0))}
        </span>
      </button>
    </li>
  );
}

function BudgetForm(props: {
  deckId: number;
  deckKey: string;
  onSelect: (card: SuggestionCard) => void;
}) {
  const [dollars, setDollars] = useState("20");
  const [result, setResult] = useState<{ list: BudgetList; deckKey: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function makeList(event: React.FormEvent) {
    event.preventDefault();
    const budget = Cents.fromUsd(dollars);
    if (budget === null || budget <= 0 || budget > 100_000) {
      setError("Enter an amount from $0.01 to $1,000.");
      return;
    }
    setError(null);
    setBusy(true);
    const list = valueOr(await budgetAction({ deckId: props.deckId, budgetCents: budget }), null);
    setBusy(false);
    if (list === null) setError("Couldn't make a list for this deck.");
    else setResult({ list, deckKey: props.deckKey });
  }

  // A list made for an earlier version of the deck may suggest cards it now has.
  const stale = result !== null && result.deckKey !== props.deckKey;
  return (
    <div className="border-border-subtle flex flex-col gap-2 border-t pt-3">
      <form onSubmit={makeList} className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          Spend up to $
          <Input
            value={dollars}
            onChange={(event) => setDollars(event.target.value)}
            inputMode="decimal"
            aria-label="Budget in dollars"
            controlSize="sm"
            className="w-20"
          />
        </label>
        <Button type="submit" disabled={busy} variant="secondary" size="sm">
          {busy ? "Choosing…" : "Make a list"}
        </Button>
      </form>
      {error && <p className="text-danger-text text-xs">{error}</p>}
      {result !== null && <HiddenOverTarget count={result.list.hiddenOverTarget} />}
      {result !== null &&
        (result.list.picks.length === 0 ? (
          <p className="text-muted text-xs">Nothing in the store fits this deck and budget.</p>
        ) : (
          <div className={`flex flex-col gap-1 ${stale ? "opacity-60" : ""}`}>
            <p>
              {result.list.picks.length} {result.list.picks.length === 1 ? "card" : "cards"} for{" "}
              {Cents.format(Cents.of(result.list.totalCents))}
              {stale && " (the deck has changed since: make the list again)"}
            </p>
            <ul aria-label="Budget list" className="flex flex-col">
              {result.list.picks.map((suggestion) => (
                <SuggestionRow
                  key={suggestion.card.oracleId}
                  suggestion={suggestion}
                  onSelect={props.onSelect}
                />
              ))}
            </ul>
            <Link
              href={`/singles/list?list=${encodeURIComponent(result.list.listText)}`}
              className="bg-accent text-accent-foreground self-start rounded-md px-3 py-1"
            >
              Buy these
            </Link>
            <p className="text-muted text-xs">
              Opens Buy a list with these cards filled in: prices are checked again there, and
              nothing is bought until you say so.
            </p>
          </div>
        ))}
    </div>
  );
}
