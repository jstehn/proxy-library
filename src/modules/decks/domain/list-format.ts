import type { Board } from "./deck";

// Deck lists as text, in and out (design doc 09, sections 9 and 10).

/** One line of a pasted deck list, understood. */
export type ListLine = Readonly<{
  quantity: number;
  name: string;
  setCode: string | null; // from "(M11)"
  collectorNumber: string | null; // from "(M11) 149"
  board: Board;
}>;

export type ParsedList = Readonly<{ lines: ListLine[]; unreadable: string[] }>;

// "4 Lightning Bolt", "4x Lightning Bolt", "1 Lightning Bolt (M11) 149", "Lightning Bolt"
const LINE = /^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+\(([A-Za-z0-9]{2,8})\)(?:\s+(\S+))?)?$/;
// Section headers used by Moxfield, Arena and MTGO exports.
const HEADERS: ReadonlyArray<[RegExp, Board]> = [
  [/^(commander|commanders)\s*:?$/i, "commander"],
  [/^(deck|main|mainboard|main deck)\s*:?$/i, "main"],
  [/^(sideboard|side|sb)\s*:?$/i, "side"],
];

/**
 * Reads a pasted list ("parse, don't validate"): each line becomes a typed ListLine, or is
 * returned as unreadable. Section headers ("Sideboard", "Commander") switch the board, and so
 * does "SB: 2 Duress".
 */
export function parseList(text: string): ParsedList {
  const lines: ListLine[] = [];
  const unreadable: string[] = [];
  let board: Board = "main";

  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (line === "" || line.startsWith("//") || line.startsWith("#")) continue;

    const header = HEADERS.find(([pattern]) => pattern.test(line));
    if (header !== undefined) {
      board = header[1];
      continue;
    }
    let lineBoard = board;
    if (/^SB:\s*/i.test(line)) {
      lineBoard = "side";
      line = line.replace(/^SB:\s*/i, "");
    }

    const match = LINE.exec(line);
    const quantity = match?.[1] === undefined ? 1 : Number(match[1]);
    const name = match?.[2]?.trim() ?? "";
    if (match === null || name === "" || quantity < 1 || quantity > 99) {
      unreadable.push(raw.trim());
      continue;
    }
    lines.push({
      quantity,
      name,
      setCode: match[3]?.toUpperCase() ?? null,
      collectorNumber: match[4] ?? null,
      board: lineBoard,
    });
  }
  return { lines, unreadable };
}

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
