// get_deck's compact view (design doc 61, section 5a): every card once, as one readable line,
// grouped the way the player groups the deck, with oracle text trimmed of what a reader doesn't
// need. Pages by whole groups so a page never splits a heading unless one heading alone is too
// big. Pure: no database, no clock.

import type { Board } from "@/modules/decks/client";

/** The facts about one deck line that the compact view shows. */
export type CompactLineSource = Readonly<{
  name: string;
  board: Board;
  quantity: number;
  heading: string | null;
  note: string | null;
  tags?: readonly string[];
  manaCost: string | null;
  typeLine: string;
  text: string;
  faceTexts?: readonly string[];
  printedStats?: string | null;
  isGameChanger: boolean;
  isBasicLand: boolean;
  owned: number;
}>;

export type CompactLineOptions = Readonly<{
  /** Append the card's (trimmed) oracle text. */
  includeText: boolean;
}>;

/** One group of card lines: a heading ("Ramp"), a card type ("Creatures"), or "Commander". */
export type CompactGroup = Readonly<{ title: string; lines: readonly string[] }>;

/** The order card-type groups appear in when a line has no heading. */
const TYPE_GROUPS = [
  { title: "Lands", pattern: /\bLand\b/ },
  { title: "Creatures", pattern: /\bCreature\b/ },
  { title: "Planeswalkers", pattern: /\bPlaneswalker\b/ },
  { title: "Battles", pattern: /\bBattle\b/ },
  { title: "Instants", pattern: /\bInstant\b/ },
  { title: "Sorceries", pattern: /\bSorcery\b/ },
  { title: "Artifacts", pattern: /\bArtifact\b/ },
  { title: "Enchantments", pattern: /\bEnchantment\b/ },
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

/** The card-type group a line falls in when it has no heading ("Artifact Creature" → Creatures). */
export function typeGroupOf(typeLine: string): string {
  const frontFace = typeLine.split("//")[0] ?? typeLine;
  const match = TYPE_GROUPS.find((group) => group.pattern.test(frontFace));
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
  const fullFaceNames = name.split(" // ").map((face) => face.trim());
  // Legends' text uses the part before the comma ("When Ojer Kaslem dies"), so that goes too.
  const shortNames = fullFaceNames.flatMap((face) => {
    const beforeComma = face.split(",")[0]?.trim() ?? "";
    return face.includes(",") && beforeComma.length >= 3 ? [beforeComma] : [];
  });
  const faceNames = [...fullFaceNames, ...shortNames];
  const faces = faceTexts !== undefined && faceTexts.length > 0 ? faceTexts : [text];
  const shortened = faces.map((faceText) => {
    let result = faceText;
    // Longest names first, so "Ojer Kaslem, Deepest Growth" goes before a shorter face name.
    for (const faceName of [...faceNames].sort((a, b) => b.length - a.length)) {
      if (faceName !== "") result = result.split(faceName).join("~");
    }
    return result
      .replace(/\s*\([^()]*\)/g, "")
      .split(/\n+/)
      .map((ability) => ability.trim())
      .filter((ability) => ability !== "")
      .join(" • ");
  });
  return shortened.filter((faceText) => faceText !== "").join(" // ");
}

/** "1 Sol Ring · {1} · Artifact · ramp — {T}: Add {C}{C}." with flags only when true. */
export function compactCardLine(line: CompactLineSource, options: CompactLineOptions): string {
  const parts = [`${line.quantity} ${line.name}`];
  if (line.manaCost !== null && line.manaCost !== "") parts.push(line.manaCost);
  const stats = line.printedStats ?? null;
  parts.push(stats === null ? line.typeLine : `${line.typeLine} ${stats}`);
  const tags = line.tags ?? [];
  if (tags.length > 0) parts.push(tags.join(", "));
  const missing = line.isBasicLand ? 0 : Math.max(0, line.quantity - line.owned);
  if (missing > 0) parts.push(`SHORT ${missing}`);
  if (line.isGameChanger) parts.push("GC");
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
    group.push(compactCardLine(line, { includeText: options.includeText }));
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
