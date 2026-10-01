import type { Board } from "./deck";

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
