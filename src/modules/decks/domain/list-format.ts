import type { Finish } from "@/modules/catalog";
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

// Generic over the line type (like a TypeVar bound in Python): any line with a board will do.
function sections<Line extends Readonly<{ board: Board }>>(
  lines: readonly Line[],
  format: (line: Line) => string,
): string {
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

/** A deck line for the Edit as text box (design doc 23). */
export type DeckTextLine = Readonly<{
  quantity: number;
  name: string;
  board: Board;
  /** Only for a pinned printing, so an unpinned card stays unpinned when the text is saved. */
  setCode: string | null;
  collectorNumber: string | null;
  /** The pinned finish; foil and etched are written as "*F*" and "*E*". */
  finish: Finish | null;
}>;

const FINISH_MARKERS: Readonly<Record<Finish, string>> = {
  nonfoil: "",
  foil: " *F*",
  etched: " *E*",
};

/**
 * A deck's whole list as text, the way the Edit as text box starts (design doc 23). Saving it
 * unchanged leaves the deck as it was (rule 3), so it names printings and finish markers.
 */
export function deckText(lines: readonly DeckTextLine[]): string {
  return sections(lines, (line) => {
    const printing =
      line.setCode === null ? "" : ` (${line.setCode}) ${line.collectorNumber ?? ""}`.trimEnd();
    const marker = line.finish === null ? "" : FINISH_MARKERS[line.finish];
    return `${line.quantity} ${line.name}${printing}${marker}`;
  });
}

/**
 * What a fingerprint reads from each entry. Plain strings, so a `DeckEntry` fits and so does a
 * deck line from a read model (which doesn't make `PrintingId` brands).
 */
export type FingerprintEntry = Readonly<{
  board: Board;
  oracleId: string;
  quantity: number;
  printingId: string | null;
  finish: Finish | null;
}>;

/**
 * A short summary of a deck's entries that changes whenever they do (design doc 23, rule 5):
 * the Edit as text box sends it back, so a save can tell the deck changed in the meantime. The
 * order entries are stored in doesn't matter. FNV-1a, a small well-known hash: this only needs
 * to notice changes, not resist an attacker (the deck is the player's own).
 */
export function fingerprint(entries: readonly FingerprintEntry[]): string {
  const canonical = entries
    .map((entry) =>
      [
        entry.board,
        entry.oracleId,
        entry.quantity,
        entry.printingId ?? "",
        entry.finish ?? "",
      ].join("|"),
    )
    .sort()
    .join("\n");
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index++) {
    hash ^= canonical.charCodeAt(index);
    // Math.imul multiplies as 32-bit integers, as the C version of FNV does.
    hash = Math.imul(hash, 0x01000193);
  }
  // `>>> 0` reads the 32 bits as unsigned, so the hex has no minus sign.
  return `${(hash >>> 0).toString(16).padStart(8, "0")}-${entries.length}`;
}

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
