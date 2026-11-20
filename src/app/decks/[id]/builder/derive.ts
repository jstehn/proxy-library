import type { BrowseCard, DeckLine, Format } from "@/modules/decks";
import { formatRules, problemsOfLines, type CardRules } from "@/modules/decks/client";
import { problemText } from "@/app/decks/labels";
import { COLORS, type ManaColor } from "@/shared/kernel";

// What the builder works out from the deck in hand (design doc 19, section 5.3): its problems,
// the commanders' colors, and a provisional line for a card the server hasn't answered for yet.
// Pure, so the browser and the tests agree with the server, which runs the same `deckProblems`.

export type ProblemInWords = Readonly<{ text: string; name: string | null }>;

/** Everything wrong with the deck in hand, in words, with the card's name when it's about one. */
export function problemsOf(
  format: Format,
  lines: readonly DeckLine[],
  rules: Readonly<Record<string, CardRules>>,
): ProblemInWords[] {
  const problems = problemsOfLines(format, lines, rules);
  return problems.map((problem) => ({
    text: problemText(problem),
    name: "name" in problem ? problem.name : null,
  }));
}

/** "4", or "3 game · 1 real" when some of the copies are real (design doc 16). */
export function ownedWords(owned: number, ownedReal: number): string {
  return ownedReal === 0 ? String(owned) : `${owned - ownedReal} game · ${ownedReal} real`;
}

/** The commanders' combined color identity, or null outside Commander or without one. */
export function commanderColorsOf(
  format: Format,
  lines: readonly DeckLine[],
  rules: Readonly<Record<string, CardRules>>,
): ManaColor[] | null {
  const commanders = lines.filter((line) => line.board === "commander");
  if (!formatRules(format).usesColorIdentity || commanders.length === 0) return null;
  const colors = new Set(commanders.flatMap((line) => rules[line.oracleId]?.colorIdentity ?? []));
  return COLORS.filter((color) => colors.has(color));
}

/** A deck line made from a grid card, shown until the server's answer replaces it. */
export function provisionalLine(
  card: BrowseCard,
  board: DeckLine["board"],
  quantity: number,
): DeckLine {
  return {
    oracleId: card.oracleId,
    board,
    quantity,
    printingId: card.printingId,
    finish: card.finish,
    // Adding from the grid pins the printing shown, not its finish (as the server will store).
    pinnedPrintingId: card.printingId,
    pinnedFinish: null,
    heading: null,
    note: null,
    name: card.name,
    typeLine: card.typeLine,
    manaValue: card.manaValue,
    manaCost: card.manaCost,
    producedMana: card.producedMana,
    roles: card.roles,
    themes: card.themes,
    leaderThemes: [],
    text: card.text,
    isGameChanger: card.isGameChanger,
    priceCents: card.priceCents,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
    // Not in the grid's facts; the server's answer brings them (they only nudge the cut ranking).
    rarity: "common",
    keywords: [],
    edhrecRank: null,
    owned: card.owned,
    ownedReal: card.ownedReal,
    isBasicLand: card.rules.isBasicLand,
    // Which decks hold the rest comes with the server's answer; the grid already knows how many are free.
    otherDecks: [],
    free: card.free,
  };
}
