// Card lists as text ("4 Lightning Bolt", "1 Sol Ring (C21) 263 *F*"), read the way deck
// sites write them. Shared by the deck importer (design doc 09) and buying a list of singles
// (design doc 15). Pure.

/** The sections a list can have; a plain shopping list is all "main". */
export type ListSection = "commander" | "main" | "side" | "maybe";

/** One line of a pasted deck list, understood. */
export type ListLine = Readonly<{
  quantity: number;
  name: string;
  setCode: string | null; // from "(M11)"
  collectorNumber: string | null; // from "(M11) 149"
  /** From Moxfield's markers: "*F*" foil, "*E*" etched; null when the line doesn't say. */
  finish: "foil" | "etched" | null;
  board: ListSection;
  /**
   * The category heading the line was under ("Ramp (9)" gives "Ramp"), on the main deck only;
   * null under a board header or a card type's title ("Creatures (30)"). Design doc 34.
   */
  heading: string | null;
  /** Moxfield `#Tag` or Archidekt `[Category]` tags found on the line. */
  tags: readonly string[];
}>;

export type ParsedList = Readonly<{ lines: ListLine[]; unreadable: string[] }>;

// "4 Lightning Bolt", "4x Lightning Bolt", "1 Lightning Bolt (M11) 149", "Lightning Bolt"
const LINE = /^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+\(([A-Za-z0-9]{2,8})\)(?:\s+(\S+))?)?$/;
// Section headers used by Moxfield, Arena and MTGO exports, with or without a count:
// "Sideboard", "Sideboard:", "Sideboard (15)". A maybeboard's lines are kept only when the
// reader asks for them (decks, design doc 32); anything else leaves them out.
const COUNT = String.raw`\s*(?::|\(\d+\))?\s*$`;
const HEADERS: ReadonlyArray<[RegExp, ListSection]> = [
  [new RegExp(String.raw`^(commander|commanders)` + COUNT, "i"), "commander"],
  [new RegExp(String.raw`^(deck|main|mainboard|main deck)` + COUNT, "i"), "main"],
  [new RegExp(String.raw`^(sideboard|side|sb)` + COUNT, "i"), "side"],
  [new RegExp(String.raw`^(maybeboard|maybe|considering)` + COUNT, "i"), "maybe"],
];
// Any other "Name (count)" line is a category heading from Archidekt or Moxfield ("Lands (36)",
// "Ramp & Mana Fixers (9)"): it starts with a letter, not a quantity, and no card name ends in
// "(digits)". Its cards are in the main deck, under that heading (design doc 34).
const CATEGORY = /^([^\d\s].*)\s\((\d+)\)$/;
// Titles of the built-in groups by card type: their cards get no heading, since grouping by
// type shows them that way anyway.
const TYPE_TITLE =
  /^(creatures?|planeswalkers?|instants?|sorcery|sorceries|artifacts?|enchantments?|battles?|lands?|other)$/i;

/**
 * Whether a list would read this as a board header ("Sideboard") or a card type's title
 * ("Creatures") rather than a heading of the deck's own: a deck can't use those as headings,
 * so every heading survives being written out and read back (design doc 34).
 */
export function isReservedTitle(title: string): boolean {
  return TYPE_TITLE.test(title) || HEADERS.some(([pattern]) => pattern.test(title));
}

/** How a list is read. A deck needs at most 99 copies of a card; a real collection more. */
export type ListOptions = Readonly<{
  maxQuantity?: number;
  /** Keep a Maybeboard / Considering section's lines (on board "maybe"); otherwise they're skipped. */
  keepMaybeboard?: boolean;
}>;

/**
 * Reads a pasted list ("parse, don't validate"): each line becomes a typed ListLine, or is
 * returned as unreadable. Section headers ("Sideboard", "Commander (1)") switch the board, and so
 * does "SB: 2 Duress". Category headings ("Ramp (9)") switch back to the main deck and give the
 * lines under them that heading.
 */
export function parseList(text: string, options: ListOptions = {}): ParsedList {
  const maxQuantity = options.maxQuantity ?? 99;
  const lines: ListLine[] = [];
  const unreadable: string[] = [];
  let board: ListSection = "main";
  let heading: string | null = null;

  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (line === "" || line.startsWith("//") || line.startsWith("#")) continue;

    const header = HEADERS.find(([pattern]) => pattern.test(line));
    if (header !== undefined) {
      board = header[1];
      heading = null;
      continue;
    }
    const category = CATEGORY.exec(line);
    if (category !== null) {
      board = "main";
      const title = category[1].trim();
      heading = TYPE_TITLE.test(title) ? null : title;
      continue;
    }
    if (board === "maybe" && options.keepMaybeboard !== true) continue;
    let lineBoard: ListSection = board;
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

    // Trailing Moxfield #Tags and Archidekt [Category] / [Tag1, Tag2] markers.
    const tags: string[] = [];
    let stripped = true;
    while (stripped) {
      stripped = false;
      const hashMatch = /\s+#([A-Za-z0-9_/-]+)$/.exec(line);
      if (hashMatch !== null) {
        const tag = hashMatch[1].replace(/_/g, " ").trim();
        if (tag !== "") tags.unshift(tag);
        line = line.slice(0, hashMatch.index).trim();
        stripped = true;
        continue;
      }
      const bracketMatch = /\s+\[([^\]]+)\]$/.exec(line);
      if (bracketMatch !== null) {
        const rawCats = bracketMatch[1]
          .split(",")
          .map((c) => c.replace(/\{[^}]*\}/g, "").trim())
          .filter((c) => c !== "");
        tags.unshift(...rawCats);
        line = line.slice(0, bracketMatch.index).trim();
        stripped = true;
      }
    }

    const match = LINE.exec(line);
    const quantity = match?.[1] === undefined ? 1 : Number(match[1]);
    const name = match?.[2]?.trim() ?? "";
    if (match === null || name === "" || quantity < 1 || quantity > maxQuantity) {
      unreadable.push(raw.trim());
      continue;
    }

    const tagHeading =
      heading === null && lineBoard === "main"
        ? (tags.find((t) => !isReservedTitle(t)) ?? null)
        : heading;

    lines.push({
      quantity,
      name,
      setCode: match[3]?.toUpperCase() ?? null,
      collectorNumber: match[4] ?? null,
      finish,
      board: lineBoard,
      heading: lineBoard === "main" ? tagHeading : null,
      tags,
    });
  }
  return { lines, unreadable };
}
