"use client";
import { NamePreview } from "@/app/_components/card-preview";
import type { PrintingCard } from "@/modules/catalog";
import type { Board, DeckLine } from "@/modules/decks";
import { ManaText } from "@/ui/mana";

// One card in the deck list: its count, name, badges and the buttons that change it.

export function ListLine(props: {
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
      title={line.role ? `Role: ${line.role}` : undefined}
      data-highlighted={props.highlighted || undefined}
      className={`group hover:bg-surface flex flex-col gap-0.5 rounded px-1 py-0.5 text-sm ${props.highlighted ? "bg-sky-100 dark:bg-sky-950" : ""}`}
    >
      <div className="flex items-center gap-2">
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
            className="shrink-0 rounded bg-gradient-to-r from-amber-200 via-pink-200 to-sky-200 px-1 text-[10px] font-medium text-black"
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
        {line.pinned && (
          <span
            title="Pinned: never suggested as a cut or replacement"
            className="text-warning-ink shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium dark:bg-amber-950"
          >
            pinned
          </span>
        )}
        {problems.length > 0 && (
          <span
            title={problems.join("\n")}
            aria-label={`Problem: ${problems.join(" ")}`}
            className="text-danger-text text-xs"
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
            className={`shrink-0 text-xs tabular-nums ${(props.yourCopies[line.oracleId] ?? 0) > 0 ? "text-success-text" : "text-muted"}`}
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
      </div>
      {line.role && <p className="text-muted pl-7 text-xs break-words italic">{line.role}</p>}
      {line.note !== null && <p className="text-muted pl-7 text-xs break-words">{line.note}</p>}
    </li>
  );
}

const control = "rounded border border-line px-1.5 text-xs leading-5 disabled:opacity-40";

/** Where a line's move button sends it: the maybeboard, or back into the deck. */
function moveTarget(board: Board): Readonly<{ to: Board; label: string; words: string }> | null {
  if (board === "maybe") return { to: "main", label: "Deck", words: "into the deck" };
  if (board === "main" || board === "side")
    return { to: "maybe", label: "Maybe", words: "to the maybeboard" };
  return null; // commanders don't move (design doc 32)
}

export function LineControls(props: {
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
