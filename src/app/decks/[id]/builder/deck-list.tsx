"use client";
import { useState } from "react";
import { CardWithPreview, NamePreview } from "@/app/_components/card-preview";
import type { PrintingCard } from "@/modules/catalog";
import type { Board, DeckLine } from "@/modules/decks";
import { mainType, TYPE_ORDER } from "@/modules/decks/client";
import { ManaText } from "@/ui/mana";

// The deck as Moxfield shows one (design doc 14, section 2.4): the commander as its card, then
// the cards grouped by type with counts and mana costs. Every name previews its card.

type Group = Readonly<{ title: string; lines: DeckLine[] }>;

/** The deck in display order: commander, the main deck by type, then the sideboard. */
function groupsOf(lines: readonly DeckLine[]): Group[] {
  const main = lines.filter((line) => line.board === "main");
  const byType = new Map<string, DeckLine[]>();
  for (const line of main) {
    const type = mainType(line.typeLine);
    byType.set(type, [...(byType.get(type) ?? []), line]);
  }
  const plural = (type: string) => (type === "Sorcery" ? "Sorceries" : `${type}s`);
  const sorted = (group: DeckLine[]) =>
    [...group].sort((a, b) => a.manaValue - b.manaValue || a.name.localeCompare(b.name));
  const groups: Group[] = [...TYPE_ORDER, "Other"]
    .filter((type) => byType.has(type))
    .map((type) => ({
      title: type === "Other" ? "Other" : plural(type),
      lines: sorted(byType.get(type) ?? []),
    }));
  const side = lines.filter((line) => line.board === "side");
  if (side.length > 0) groups.push({ title: "Sideboard", lines: sorted(side) });
  return groups;
}

const count = (lines: readonly DeckLine[]) => lines.reduce((sum, line) => sum + line.quantity, 0);

export function DeckList(props: {
  lines: readonly DeckLine[];
  cards: Readonly<Record<string, PrintingCard>>;
  /** Problem messages per card name, to mark their lines. */
  problemsByName: ReadonlyMap<string, string[]>;
  onChange: (line: DeckLine, quantity: number) => void;
  onSelect: (line: DeckLine) => void;
  busy: boolean;
}) {
  const [view, setView] = useState<"list" | "visual">("list");
  const commanders = props.lines.filter((line) => line.board === "commander");
  const groups = groupsOf(props.lines);

  return (
    <section aria-label="Deck list" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Deck</h2>
        <div role="group" aria-label="Deck view" className="flex gap-1 text-xs">
          {(["list", "visual"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={`rounded px-2 py-0.5 ${view === option ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}
            >
              {option === "list" ? "List" : "Visual"}
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
                  <LineControls line={line} onChange={props.onChange} busy={props.busy} />
                </div>
              ) : (
                <ListLine key={line.oracleId} line={line} {...props} />
              );
            })}
          </div>
        </div>
      )}

      {props.lines.length === 0 && (
        <p className="text-sm text-zinc-500">
          Empty so far. Select cards from your collection and add them.
        </p>
      )}

      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            {group.title} ({count(group.lines)})
          </h3>
          {view === "list" ? (
            <ul className="flex flex-col">
              {group.lines.map((line) => (
                <ListLine key={`${line.board}-${line.oracleId}`} line={line} {...props} />
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
                      className={`aspect-[146/204] w-full rounded-[4.5%] bg-zinc-100 dark:bg-zinc-800 ${props.problemsByName.has(line.name) ? "ring-2 ring-red-500" : ""}`}
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
          )}
        </div>
      ))}
    </section>
  );
}

function ListLine(props: {
  line: DeckLine;
  cards: Readonly<Record<string, PrintingCard>>;
  problemsByName: ReadonlyMap<string, string[]>;
  onChange: (line: DeckLine, quantity: number) => void;
  onSelect: (line: DeckLine) => void;
  busy: boolean;
}) {
  const { line } = props;
  const problems = props.problemsByName.get(line.name) ?? [];
  return (
    <li className="group flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900">
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
      <LineControls line={line} onChange={props.onChange} busy={props.busy} />
    </li>
  );
}

const control =
  "rounded border border-zinc-300 px-1.5 text-xs leading-5 disabled:opacity-40 dark:border-zinc-700";

function LineControls(props: {
  line: DeckLine;
  onChange: (line: DeckLine, quantity: number) => void;
  busy: boolean;
}) {
  const { line } = props;
  return (
    <span className="flex shrink-0 gap-0.5">
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
};
