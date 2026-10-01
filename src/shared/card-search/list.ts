// Card lists as text ("4 Lightning Bolt", "1 Sol Ring (C21) 263 *F*"), read the way deck
// sites write them. Shared by the deck importer (design doc 09) and buying a list of singles
// (design doc 15). Pure.

/** The sections a list can have; a plain shopping list is all "main". */
export type ListSection = "commander" | "main" | "side";

/** One line of a pasted deck list, understood. */
export type ListLine = Readonly<{
  quantity: number;
  name: string;
  setCode: string | null; // from "(M11)"
  collectorNumber: string | null; // from "(M11) 149"
  /** From Moxfield's markers: "*F*" foil, "*E*" etched; null when the line doesn't say. */
  finish: "foil" | "etched" | null;
  board: ListSection;
}>;

export type ParsedList = Readonly<{ lines: ListLine[]; unreadable: string[] }>;

// "4 Lightning Bolt", "4x Lightning Bolt", "1 Lightning Bolt (M11) 149", "Lightning Bolt"
const LINE = /^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+\(([A-Za-z0-9]{2,8})\)(?:\s+(\S+))?)?$/;
// Section headers used by Moxfield, Arena and MTGO exports.
const HEADERS: ReadonlyArray<[RegExp, ListSection]> = [
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
  let board: ListSection = "main";

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

    // Moxfield's finish markers, anywhere after the name: "1 Sol Ring (C21) 263 *F*".
    let finish: ListLine["finish"] = null;
    const marker = /\s*\*([FE])\*\s*/i.exec(line);
    if (marker !== null) {
      finish = marker[1].toUpperCase() === "F" ? "foil" : "etched";
      line = (
        line.slice(0, marker.index) +
        " " +
        line.slice(marker.index + marker[0].length)
      ).trim();
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
      finish,
      board: lineBoard,
    });
  }
  return { lines, unreadable };
}
