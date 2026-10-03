import type { Board } from "./deck";
import type { DeckProblem } from "./rules";

// Deck lists as text, out (design doc 09, section 10). Reading lists in is shared with the
// store: @/shared/card-search (design doc 15).

/** A deck line ready to export: the card's name and, if pinned, its printing. */
export type ExportLine = Readonly<{
  quantity: number;
  name: string;
  board: Board;
  setCode: string | null;
  collectorNumber: string | null;
}>;

/** Every exporter has the same shape (Strategy): lines in, text out. */
export type Exporter = (lines: readonly ExportLine[]) => string;

function sections(lines: readonly ExportLine[], format: (line: ExportLine) => string): string {
  const parts: string[] = [];
  const titles: Record<Board, string> = { commander: "Commander", main: "Deck", side: "Sideboard" };
  for (const board of ["commander", "main", "side"] as const) {
    const onBoard = lines.filter((line) => line.board === board);
    if (onBoard.length > 0) parts.push([titles[board], ...onBoard.map(format)].join("\n"));
  }
  return parts.join("\n\n");
}

export const EXPORTERS: Readonly<Record<"printings" | "names", Exporter>> = {
  /** "4 Lightning Bolt (M11) 149": Moxfield, Archidekt and Arena all read this. */
  printings: (lines) =>
    sections(lines, (line) =>
      line.setCode === null
        ? `${line.quantity} ${line.name}`
        : `${line.quantity} ${line.name} (${line.setCode}) ${line.collectorNumber ?? ""}`.trim(),
    ),
  /** "4 Lightning Bolt": for anything else. */
  names: (lines) => sections(lines, (line) => `${line.quantity} ${line.name}`),
};

/** What the shopping list needs to know about a deck line: its card and finish. */
export type ShortLine = Readonly<{
  oracleId: string;
  name: string;
  finish: "nonfoil" | "foil" | "etched";
}>;

/**
 * The cards a deck is short of, as a list to buy (design doc 15, decision 3): "4 Lightning Bolt",
 * with "*F*" or "*E*" when the deck's copy is foil or etched. Basic lands are never short.
 *
 * Each line asks for as many as the deck uses, not the difference: Buy a list's "only buy what I
 * don't already own" (on by default) subtracts your copies itself. Writing the difference made
 * it subtract them twice (found in phase 21: needing 4 and owning 1 bought 2).
 */
export function shortList(problems: readonly DeckProblem[], lines: readonly ShortLine[]): string {
  return problems
    .flatMap((problem) => {
      if (problem.kind !== "Short") return [];
      const finish = lines.find((line) => line.oracleId === problem.oracleId)?.finish ?? "nonfoil";
      const marker = finish === "foil" ? " *F*" : finish === "etched" ? " *E*" : "";
      return [`${problem.needed} ${problem.name}${marker}`];
    })
    .join("\n");
}
