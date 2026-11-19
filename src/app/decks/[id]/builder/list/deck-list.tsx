"use client";
import { useState } from "react";
import { CardWithPreview } from "@/app/_components/card-preview";
import type { PrintingCard } from "@/modules/catalog";
import type { Board, DeckLine, Grouping } from "@/modules/decks";
import type { Tag } from "@/shared/card-search";
import { groupsByHeading, groupsByRole, groupsOf, tagsOf } from "./groups";
import { HeadingTitle } from "./heading-title";
import { LineControls, ListLine } from "./list-line";

// The deck as Moxfield shows one (design doc 14, section 2.4): the commander as its card, then
// the cards grouped by type, by the deck's own headings (design doc 34) or by role (design doc
// 19), with counts and mana costs. Every name previews its card.

// "By type" and "By heading" are the deck's grouping, saved with it (design doc 34); "By role"
// and "Visual" are passing views (Visual shows the deck's grouping as pictures).
const VIEWS = {
  list: "By type",
  headings: "By heading",
  roles: "By role",
  visual: "Visual",
} as const;
type View = keyof typeof VIEWS;

const count = (lines: readonly DeckLine[]) => lines.reduce((sum, line) => sum + line.quantity, 0);

export function DeckList(props: {
  lines: readonly DeckLine[];
  cards: Readonly<Record<string, PrintingCard>>;
  /** Problem messages per card name, to mark their lines. */
  problemsByName: ReadonlyMap<string, string[]>;
  onChange: (line: DeckLine, quantity: number) => void;
  onSelect: (line: DeckLine) => void;
  /** Moves a line to another board: to the maybeboard and back (design doc 32). */
  onMove?: (line: DeckLine, to: Board) => void;
  busy: boolean;
  /** Lines with this role are marked (chosen in the statistics). */
  highlighted: Tag | null;
  /** Cards marked by name: a bracket reason chosen in the bracket panel (design doc 31). */
  highlightedNames?: ReadonlySet<string>;
  /** Someone else's shared deck (design doc 21): no controls. */
  readOnly?: boolean;
  /** The viewer's own copies of each card, shown on a shared deck (by oracle id). */
  yourCopies?: Readonly<Record<string, number>>;
  /** By type or by the deck's own headings, and the headings in order (design doc 34). */
  grouping: Grouping;
  headings: readonly string[];
  /** Saves the deck's grouping when By type or By heading is chosen (the owner only). */
  onGrouping?: (grouping: Grouping) => void;
  /** Moves a heading up or down the order. */
  onMoveHeading?: (heading: string, direction: "up" | "down") => void;
  /** Renames a heading (onto another merges them), or clears it with null. */
  onRenameHeading?: (from: string, to: string | null) => void;
}) {
  const [passingView, setPassingView] = useState<"roles" | "visual" | null>(null);
  const view: View = passingView ?? (props.grouping === "custom" ? "headings" : "list");
  const choose = (option: View) => {
    if (option === "roles" || option === "visual") {
      setPassingView(option);
      return;
    }
    setPassingView(null);
    const grouping: Grouping = option === "headings" ? "custom" : "type";
    if (grouping !== props.grouping) props.onGrouping?.(grouping);
  };
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const deckTags = [...new Set(props.lines.flatMap((line) => line.tags ?? []))].sort((a, b) =>
    a.localeCompare(b),
  );
  const activeTag = tagFilter !== null && deckTags.includes(tagFilter) ? tagFilter : null;
  const shownLines =
    activeTag === null
      ? props.lines
      : props.lines.filter(
          (line) => line.board === "commander" || (line.tags ?? []).includes(activeTag),
        );
  const commanders = props.lines.filter((line) => line.board === "commander");
  const groups =
    view === "roles"
      ? groupsByRole(shownLines)
      : props.grouping === "custom"
        ? groupsByHeading(shownLines, props.headings)
        : groupsOf(shownLines);
  // Someone else's deck shows its owner's grouping; only the owner can switch it.
  const options = (Object.keys(VIEWS) as View[]).filter(
    (option) =>
      props.onGrouping !== undefined ||
      option === "roles" ||
      option === "visual" ||
      option === (props.grouping === "custom" ? "headings" : "list"),
  );
  const isHighlighted = (line: DeckLine) =>
    (props.highlighted !== null && tagsOf(line).includes(props.highlighted)) ||
    (props.highlightedNames?.has(line.name) ?? false);

  return (
    <section aria-label="Deck list" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Deck</h2>
        <div role="group" aria-label="Deck view" className="flex gap-1 text-xs">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => choose(option)}
              className={`rounded px-2 py-0.5 ${view === option ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}
            >
              {VIEWS[option]}
            </button>
          ))}
        </div>
      </div>

      {deckTags.length > 0 && (
        <div role="group" aria-label="Filter by tag" className="flex flex-wrap gap-1 text-xs">
          {[null, ...deckTags].map((tag) => (
            <button
              key={tag ?? "all"}
              type="button"
              aria-pressed={activeTag === tag}
              onClick={() => setTagFilter(tag)}
              className={`min-h-7 rounded px-2 py-0.5 ${activeTag === tag ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}
            >
              {tag ?? "All tags"}
            </button>
          ))}
        </div>
      )}

      {commanders.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-muted text-xs font-medium tracking-wide uppercase">
            Commander ({count(commanders)})
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {commanders.map((line) => {
              const card = props.cards[line.printingId];
              return card ? (
                <div key={line.oracleId} className="flex flex-col gap-1">
                  <CardWithPreview printing={card} />
                  {!props.readOnly && (
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      {/* The picture only shows the card's text; this opens it in the panel
                          (to change its printing, design doc 24). */}
                      <button
                        type="button"
                        onClick={() => props.onSelect(line)}
                        aria-label={`Select ${line.name}`}
                        className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700"
                      >
                        Select
                      </button>
                      <LineControls line={line} onChange={props.onChange} busy={props.busy} />
                    </div>
                  )}
                </div>
              ) : (
                <ListLine
                  key={line.oracleId}
                  line={line}
                  {...props}
                  highlighted={isHighlighted(line)}
                />
              );
            })}
          </div>
        </div>
      )}

      {props.lines.length === 0 && (
        <p className="text-muted text-sm">
          {props.readOnly
            ? "Nothing in this deck yet."
            : "Empty so far. Select cards from your collection and add them."}
        </p>
      )}

      {groups.map((group) => {
        const heading = `${group.title} (${count(group.lines)})`;
        const body =
          view !== "visual" ? (
            <ul className="flex flex-col">
              {group.lines.map((line) => (
                <ListLine
                  key={`${line.board}-${line.oracleId}`}
                  line={line}
                  {...props}
                  highlighted={isHighlighted(line)}
                />
              ))}
            </ul>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
              {group.lines.map((line) => (
                <li key={`${line.board}-${line.oracleId}`} className="relative">
                  <button
                    type="button"
                    onClick={() => props.onSelect(line)}
                    aria-label={`${line.quantity} ${line.name}`}
                    className="block w-full"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/images/${line.printingId}/small/front`}
                      alt=""
                      loading="lazy"
                      className={`aspect-[146/204] w-full rounded-[4.5%] bg-zinc-100 dark:bg-zinc-800 ${props.problemsByName.has(line.name) ? "ring-2 ring-red-500" : isHighlighted(line) ? "ring-2 ring-sky-500" : ""}`}
                    />
                  </button>
                  {line.quantity > 1 && (
                    <span className="absolute top-1 left-1 rounded bg-black/75 px-1.5 text-xs font-semibold text-white">
                      ×{line.quantity}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          );
        // The maybeboard isn't part of the deck: it stays closed until you open it.
        return group.collapsed ? (
          <details key={group.title} className="flex flex-col gap-1">
            <summary className="text-muted cursor-pointer text-xs font-medium tracking-wide uppercase">
              {heading} · not counted
            </summary>
            {body}
          </details>
        ) : (
          <div key={group.title} className="flex flex-col gap-1">
            {group.heading !== undefined && props.onRenameHeading !== undefined ? (
              <HeadingTitle
                heading={group.heading}
                title={heading}
                headings={props.headings}
                busy={props.busy}
                onMove={props.onMoveHeading}
                onRename={props.onRenameHeading}
              />
            ) : (
              <h3 className="text-muted text-xs font-medium tracking-wide uppercase">{heading}</h3>
            )}
            {body}
          </div>
        );
      })}
    </section>
  );
}
