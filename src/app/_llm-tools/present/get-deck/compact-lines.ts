// get_deck's compact view (design doc 61, section 5a): every card once, as one readable line,
// grouped the way the player groups the deck, with oracle text trimmed of what a reader doesn't
// need. Pages by whole groups so a page never splits a heading unless one heading alone is too
// big. Pure: no database, no clock.

import { hasTypeWord, isLand, isCreature, plainText, type CardFacts } from "@/shared/mtg";
import type { DeckCount } from "@/modules/decks/client";

/** The facts about one deck line that the compact view shows. */
export type CompactLineSource = DeckCount &
  Pick<CardFacts, "name" | "manaCost" | "typeLine" | "text"> &
  Readonly<{
    heading: string | null;
    note: string | null;
    tags?: readonly string[];
    /** The card's one-line job in this deck. */
    role?: string | null;
    /** Pinned on the line or a keyCard in the deck profile: never suggested as a cut. */
    pinned?: boolean;
    faceTexts?: readonly string[];
    printedStats?: string | null;
    isGameChanger: boolean;
    isBasicLand: boolean;
    owned: number;
  }>;

export type CompactLineOptions = Readonly<{
  /** Append the card's (trimmed) oracle text. */
  includeText: boolean;
  /** The group the line sits under; a type line that only repeats it ("Instant") is left out. */
  groupTypeLine?: string;
}>;

/** One group of card lines: a heading ("Ramp"), a card type ("Creatures"), or "Commander". */
export type CompactGroup = Readonly<{ title: string; lines: readonly string[] }>;

/** The order card-type groups appear in when a line has no heading. */
const TYPE_GROUPS = [
  { title: "Planeswalkers", word: "Planeswalker" },
  { title: "Battles", word: "Battle" },
  { title: "Instants", word: "Instant" },
  { title: "Sorceries", word: "Sorcery" },
  { title: "Artifacts", word: "Artifact" },
  { title: "Enchantments", word: "Enchantment" },
] as const;

const DISPLAY_ORDER = [
  "Creatures",
  "Planeswalkers",
  "Battles",
  "Instants",
  "Sorceries",
  "Artifacts",
  "Enchantments",
  "Other",
  "Lands",
];

/** The type line a group's cards share, when one line can say it for the whole group. */
const GROUP_TYPE_LINES: Record<string, string> = {
  Planeswalkers: "Planeswalker",
  Battles: "Battle",
  Instants: "Instant",
  Sorceries: "Sorcery",
  Artifacts: "Artifact",
  Enchantments: "Enchantment",
  Lands: "Land",
};

/** The card-type group a line falls in when it has no heading ("Artifact Creature" → Creatures). */
export function typeGroupOf(typeLine: string): string {
  if (isLand(typeLine)) return "Lands"; // a land on either face (STATUS decision 1)
  const frontFace = typeLine.split("//")[0] ?? typeLine;
  if (isCreature(frontFace)) return "Creatures";
  const match = TYPE_GROUPS.find((group) => hasTypeWord(frontFace, [group.word]));
  return match?.title ?? "Other";
}

/**
 * Oracle text made shorter without losing rules: the card's own name becomes "~", reminder text
 * in parentheses is dropped, and line breaks between abilities become " • ". Double-faced cards
 * keep their faces apart with " // ".
 */
export function shortenOracleText(
  name: string,
  text: string,
  faceTexts?: readonly string[],
): string {
  const faceNames = name.split(" // ").map((face) => face.trim());
  const faces = faceTexts !== undefined && faceTexts.length > 0 ? faceTexts : [text];
  const shortened = faces.map((faceText) =>
    plainText(faceText, faceNames)
      .split(/\n+/)
      .map((ability) => ability.trim())
      .filter((ability) => ability !== "")
      .join(" • "),
  );
  return shortened.filter((faceText) => faceText !== "").join(" // ");
}

/**
 * "1 Sol Ring · {1} · ramp — {T}: Add {C}{C}." (the type line is left out when the group says it) with flags only when true:
 * SHORT n, GC, PINNED, role and note.
 */
export function compactCardLine(line: CompactLineSource, options: CompactLineOptions): string {
  const parts = [`${line.quantity} ${line.name}`];
  if (line.manaCost !== null && line.manaCost !== "") parts.push(line.manaCost);
  const stats = line.printedStats ?? null;
  const typeLine = line.typeLine === options.groupTypeLine ? "" : line.typeLine;
  const shownType = stats === null ? typeLine : `${typeLine} ${stats}`.trim();
  if (shownType !== "") parts.push(shownType);
  const tags = line.tags ?? [];
  if (tags.length > 0) parts.push(tags.join(", "));
  const missing = line.isBasicLand ? 0 : Math.max(0, line.quantity - line.owned);
  if (missing > 0) parts.push(`SHORT ${missing}`);
  if (line.isGameChanger) parts.push("GC");
  if (line.pinned === true) parts.push("PINNED");
  if (line.role !== undefined && line.role !== null && line.role !== "") {
    parts.push(`role: ${line.role}`);
  }
  if (line.note !== null && line.note.trim() !== "") parts.push(`note: ${line.note.trim()}`);
  let result = parts.join(" · ");
  if (options.includeText && !line.isBasicLand) {
    const text = shortenOracleText(line.name, line.text, line.faceTexts);
    if (text !== "") result += ` — ${text}`;
  }
  return result;
}

export type GroupingOptions = Readonly<{
  /** Group by the deck's own headings (its grouping is "custom"); otherwise by card type. */
  byHeading: boolean;
  /** The deck's headings in the player's order. */
  headings: readonly string[];
  includeText: boolean;
}>;

/** The lines in groups: "Commander" first, then the headings in order, then card types. */
export function groupCompactLines(
  lines: readonly CompactLineSource[],
  options: GroupingOptions,
): CompactGroup[] {
  const byTitle = new Map<string, string[]>();
  for (const line of lines) {
    const title =
      line.board === "commander"
        ? "Commander"
        : options.byHeading && line.heading !== null
          ? line.heading
          : typeGroupOf(line.typeLine);
    const group = byTitle.get(title) ?? [];
    const byType = !(options.byHeading && line.heading !== null) && line.board !== "commander";
    group.push(
      compactCardLine(line, {
        includeText: options.includeText,
        ...(byType && GROUP_TYPE_LINES[title] !== undefined
          ? { groupTypeLine: GROUP_TYPE_LINES[title] }
          : {}),
      }),
    );
    byTitle.set(title, group);
  }
  const order = ["Commander", ...options.headings, ...DISPLAY_ORDER];
  const rank = (title: string) => {
    const index = order.indexOf(title);
    return index === -1 ? order.length : index;
  };
  return [...byTitle.entries()]
    .sort(([first], [second]) => rank(first) - rank(second) || first.localeCompare(second))
    .map(([title, groupLines]) => ({ title, lines: groupLines }));
}

export type CompactPage = Readonly<{
  /** Group title → its card lines; a group split across pages keeps its title on both. */
  cards: Record<string, string[]>;
  /** The cursor for the next page, when there is one. */
  next?: number;
  /** All card lines across every page. */
  totalLines: number;
}>;

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/**
 * One page of groups within `budgetBytes`, starting at card line `cursor` (counted across all
 * groups in order). It stops at the end of a group when the next whole group won't fit, and only
 * splits a group when that group alone is bigger than the page.
 */
export function pageCompactGroups(
  groups: readonly CompactGroup[],
  budgetBytes: number,
  cursor = 0,
): CompactPage {
  const flat = groups.flatMap((group) => group.lines.map((line) => ({ title: group.title, line })));
  const totalLines = flat.length;
  const cards: Record<string, string[]> = {};
  let used = 2;
  let index = Math.min(Math.max(cursor, 0), totalLines);
  while (index < totalLines) {
    const title = flat[index]?.title ?? "";
    let groupEnd = index;
    while (groupEnd < totalLines && flat[groupEnd]?.title === title) groupEnd += 1;
    const groupLines = flat.slice(index, groupEnd).map((entry) => entry.line);
    const groupBytes = bytes(title) + 2 + bytes(groupLines);
    if (used + groupBytes <= budgetBytes) {
      cards[title] = groupLines;
      used += groupBytes;
      index = groupEnd;
      continue;
    }
    if (Object.keys(cards).length > 0) break;
    // This group alone is too big for a page: take as many of its lines as fit (at least one).
    const taken: string[] = [];
    used += bytes(title) + 4;
    for (const line of groupLines) {
      const lineBytes = bytes(line) + 1;
      if (taken.length > 0 && used + lineBytes > budgetBytes) break;
      taken.push(line);
      used += lineBytes;
    }
    cards[title] = taken;
    index += taken.length;
    break;
  }
  return { cards, ...(index < totalLines ? { next: index } : {}), totalLines };
}
