"use client";
import { useState } from "react";
import { CardWithPreview, NamePreview } from "@/app/_components/card-preview";
import type { PrintingCard } from "@/modules/catalog";
import type { Board, DeckLine, Grouping } from "@/modules/decks";
import { mainType, TYPE_ORDER } from "@/modules/decks/client";
import { cardTags, TAGS, type Tag } from "@/shared/card-search";
import { ManaText } from "@/ui/mana";
import { TAG_LABELS } from "../../labels";

// The deck as Moxfield shows one (design doc 14, section 2.4): the commander as its card, then
// the cards grouped by type, by the deck's own headings (design doc 34) or by role (design doc
// 19), with counts and mana costs. Every name previews its card.

type Group = Readonly<{
  title: string;
  lines: DeckLine[];
  /** Shown closed until opened: the maybeboard (design doc 32). */
  collapsed?: boolean;
  /** The deck's own heading this group is (design doc 34), for its ↑ ↓ and Rename buttons. */
  heading?: string;
}>;

/** A line's roles, read from its rules text. */
function tagsOf(line: DeckLine): Tag[] {
  return cardTags({ typeLine: line.typeLine, text: line.text, producedMana: line.producedMana });
}

const sortedByCost = (group: readonly DeckLine[]) =>
  [...group].sort((a, b) => a.manaValue - b.manaValue || a.name.localeCompare(b.name));

/** The sideboard, then the maybeboard (closed until opened), after the main deck's groups. */
function sideboardGroup(lines: readonly DeckLine[]): Group[] {
  const side = lines.filter((line) => line.board === "side");
  const maybe = lines.filter((line) => line.board === "maybe");
  return [
    ...(side.length > 0 ? [{ title: "Sideboard", lines: sortedByCost(side) }] : []),
    ...(maybe.length > 0
      ? [{ title: "Maybeboard", lines: sortedByCost(maybe), collapsed: true }]
      : []),
  ];
}

/**
 * The main deck by role, then the sideboard. A card with two roles shows under both; the counts
 * then add up to more than the deck, as the role statistics do.
 */
function groupsByRole(lines: readonly DeckLine[]): Group[] {
  const main = lines.filter((line) => line.board === "main");
  const groups: Group[] = TAGS.map((tag) => ({
    title: TAG_LABELS[tag],
    lines: sortedByCost(main.filter((line) => tagsOf(line).includes(tag))),
  }));
  const lands = main.filter(
    (line) => mainType(line.typeLine) === "Land" && tagsOf(line).length === 0,
  );
  const other = main.filter(
    (line) => mainType(line.typeLine) !== "Land" && tagsOf(line).length === 0,
  );
  groups.push(
    { title: "Other", lines: sortedByCost(other) },
    { title: "Lands", lines: sortedByCost(lands) },
  );
  return [...groups.filter((group) => group.lines.length > 0), ...sideboardGroup(lines)];
}

/** The deck in display order: commander, the main deck by type, then the sideboard. */
function groupsOf(lines: readonly DeckLine[]): Group[] {
  return [...typeGroups(lines.filter((line) => line.board === "main")), ...sideboardGroup(lines)];
}

/**
 * The main deck by the deck's own headings, in its order, then the cards with no heading in
 * their usual groups by type (design doc 34, decision 2), then the sideboard.
 */
function groupsByHeading(lines: readonly DeckLine[], headings: readonly string[]): Group[] {
  const main = lines.filter((line) => line.board === "main");
  const headed: Group[] = headings
    .map((heading) => ({
      title: heading,
      heading,
      lines: sortedByCost(main.filter((line) => line.heading === heading)),
    }))
    .filter((group) => group.lines.length > 0);
  const rest = main.filter((line) => line.heading === null || !headings.includes(line.heading));
  return [...headed, ...typeGroups(rest), ...sideboardGroup(lines)];
}

/** Main-deck lines grouped by card type: Creatures, Planeswalkers, ... Lands, Other. */
function typeGroups(main: readonly DeckLine[]): Group[] {
  const byType = new Map<string, DeckLine[]>();
  for (const line of main) {
    const type = mainType(line.typeLine);
    byType.set(type, [...(byType.get(type) ?? []), line]);
  }
  const plural = (type: string) => (type === "Sorcery" ? "Sorceries" : `${type}s`);
  return [...TYPE_ORDER, "Other"]
    .filter((type) => byType.has(type))
    .map((type) => ({
      title: type === "Other" ? "Other" : plural(type),
      lines: sortedByCost(byType.get(type) ?? []),
    }));
}

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
  const commanders = props.lines.filter((line) => line.board === "commander");
  const groups =
    view === "roles"
      ? groupsByRole(props.lines)
      : props.grouping === "custom"
        ? groupsByHeading(props.lines, props.headings)
        : groupsOf(props.lines);
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

      {commanders.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
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
        <p className="text-sm text-zinc-500">
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
            <summary className="cursor-pointer text-xs font-medium tracking-wide text-zinc-500 uppercase">
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
              <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
                {heading}
              </h3>
            )}
            {body}
          </div>
        );
      })}
    </section>
  );
}

/**
 * A heading of the deck's own, with ↑ ↓ to move it and Rename (design doc 34). Renaming onto
 * another heading merges the two; Clear takes it off its cards, which go back to their type.
 */
function HeadingTitle(props: {
  heading: string;
  title: string;
  headings: readonly string[];
  busy: boolean;
  onMove?: (heading: string, direction: "up" | "down") => void;
  onRename: (from: string, to: string | null) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(props.heading);
  const index = props.headings.indexOf(props.heading);
  const small =
    "rounded border border-zinc-300 px-1.5 text-xs leading-5 normal-case disabled:opacity-40 dark:border-zinc-700";

  if (renaming) {
    const merges = name.trim() !== props.heading && props.headings.includes(name.trim());
    return (
      <form
        className="flex flex-wrap items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          setRenaming(false);
          if (name.trim() !== props.heading) props.onRename(props.heading, name);
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={`New name for ${props.heading}`}
          maxLength={40}
          autoFocus
          className="min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-sm dark:border-zinc-700"
        />
        <button type="submit" className={small}>
          {merges ? "Merge" : "Save"}
        </button>
        <button
          type="button"
          className={small}
          onClick={() => {
            setRenaming(false);
            props.onRename(props.heading, null);
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className={small}
          onClick={() => {
            setRenaming(false);
            setName(props.heading);
          }}
        >
          Cancel
        </button>
      </form>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <h3 className="min-w-0 flex-1 truncate text-xs font-medium tracking-wide text-zinc-500 uppercase">
        {props.title}
      </h3>
      {props.onMove !== undefined && (
        <>
          <button
            type="button"
            className={small}
            disabled={props.busy || index <= 0}
            onClick={() => props.onMove?.(props.heading, "up")}
            aria-label={`Move ${props.heading} up`}
          >
            ↑
          </button>
          <button
            type="button"
            className={small}
            disabled={props.busy || index < 0 || index >= props.headings.length - 1}
            onClick={() => props.onMove?.(props.heading, "down")}
            aria-label={`Move ${props.heading} down`}
          >
            ↓
          </button>
        </>
      )}
      <button
        type="button"
        className={small}
        disabled={props.busy}
        onClick={() => {
          setName(props.heading);
          setRenaming(true);
        }}
        aria-label={`Rename ${props.heading}`}
      >
        Rename
      </button>
    </div>
  );
}

function ListLine(props: {
  line: DeckLine;
  cards: Readonly<Record<string, PrintingCard>>;
  problemsByName: ReadonlyMap<string, string[]>;
  onChange: (line: DeckLine, quantity: number) => void;
  onSelect: (line: DeckLine) => void;
  onMove?: (line: DeckLine, to: Board) => void;
  busy: boolean;
  highlighted: boolean;
  readOnly?: boolean;
  yourCopies?: Readonly<Record<string, number>>;
}) {
  const { line } = props;
  const problems = props.problemsByName.get(line.name) ?? [];
  return (
    <li
      data-highlighted={props.highlighted || undefined}
      className={`group flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900 ${props.highlighted ? "bg-sky-100 dark:bg-sky-950" : ""}`}
    >
      <span className="w-5 text-right tabular-nums">{line.quantity}</span>
      <NamePreview
        printing={props.cards[line.printingId]}
        name={line.name}
        onSelect={() => props.onSelect(line)}
        className="min-w-0 flex-1"
      />
      {line.finish !== "nonfoil" && (
        <span
          title={`The deck's copy is ${line.finish}: it prints with the foils`}
          className="shrink-0 rounded bg-gradient-to-r from-amber-200 via-pink-200 to-sky-200 px-1 text-[10px] font-medium text-zinc-900"
        >
          {line.finish === "etched" ? "etched" : "foil"}
        </span>
      )}
      {line.isGameChanger && (
        <span
          title="On Wizards' Game Changer list: none in brackets 1–2, up to three in bracket 3"
          className="shrink-0 rounded bg-violet-100 px-1 text-[10px] font-medium text-violet-900 dark:bg-violet-950 dark:text-violet-200"
        >
          GC
        </span>
      )}
      {problems.length > 0 && (
        <span
          title={problems.join("\n")}
          aria-label={`Problem: ${problems.join(" ")}`}
          className="text-xs text-red-600 dark:text-red-400"
        >
          ⚠
        </span>
      )}
      {line.manaCost && (
        <span className="shrink-0 text-xs">
          <ManaText text={line.manaCost} />
        </span>
      )}
      {props.yourCopies !== undefined && (
        <span
          className={`shrink-0 text-xs tabular-nums ${(props.yourCopies[line.oracleId] ?? 0) > 0 ? "text-green-700 dark:text-green-400" : "text-zinc-500"}`}
          title="How many you own"
        >
          you {props.yourCopies[line.oracleId] ?? 0}
        </span>
      )}
      {!props.readOnly && (
        <LineControls
          line={line}
          onChange={props.onChange}
          onMove={props.onMove}
          busy={props.busy}
        />
      )}
    </li>
  );
}

const control =
  "rounded border border-zinc-300 px-1.5 text-xs leading-5 disabled:opacity-40 dark:border-zinc-700";

/** Where a line's move button sends it: the maybeboard, or back into the deck. */
function moveTarget(board: Board): Readonly<{ to: Board; label: string; words: string }> | null {
  if (board === "maybe") return { to: "main", label: "Deck", words: "into the deck" };
  if (board === "main" || board === "side")
    return { to: "maybe", label: "Maybe", words: "to the maybeboard" };
  return null; // commanders don't move (design doc 32)
}

function LineControls(props: {
  line: DeckLine;
  onChange: (line: DeckLine, quantity: number) => void;
  onMove?: (line: DeckLine, to: Board) => void;
  busy: boolean;
}) {
  const { line, onMove } = props;
  const move = moveTarget(line.board);
  return (
    <span className="flex shrink-0 gap-0.5">
      {onMove !== undefined && move !== null && (
        <button
          type="button"
          className={control}
          aria-label={`Move ${line.name} ${move.words}`}
          title={`Move ${move.words}`}
          onClick={() => onMove(line, move.to)}
        >
          {move.label}
        </button>
      )}
      <button
        type="button"
        className={control}
        aria-label={`One fewer ${line.name}`}
        onClick={() => props.onChange(line, line.quantity - 1)}
      >
        −
      </button>
      <button
        type="button"
        className={control}
        aria-label={`One more ${line.name}`}
        onClick={() => props.onChange(line, line.quantity + 1)}
      >
        +
      </button>
      <button
        type="button"
        className={control}
        aria-label={`Remove ${line.name}`}
        onClick={() => props.onChange(line, 0)}
      >
        ×
      </button>
    </span>
  );
}

/** Board names as the builder shows them. */
export const BOARD_LABELS: Record<Board, string> = {
  commander: "Commander",
  main: "Main deck",
  side: "Sideboard",
  maybe: "Maybeboard",
};
