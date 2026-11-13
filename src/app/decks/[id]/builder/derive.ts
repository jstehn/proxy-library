import type { BrowseCard, DeckLine, Format } from "@/modules/decks";
import { deckProblems, type CardRules } from "@/modules/decks/client";
import { problemText } from "../../labels";

// What the builder works out from the deck in hand (design doc 19, section 5.3): its problems,
// the commanders' colors, and a provisional line for a card the server hasn't answered for yet.
// Pure, so the browser and the tests agree with the server, which runs the same `deckProblems`.

type Color = "W" | "U" | "B" | "R" | "G";

export type ProblemInWords = Readonly<{ text: string; name: string | null }>;

/** Everything wrong with the deck in hand, in words, with the card's name when it's about one. */
export function problemsOf(
  format: Format,
  lines: readonly DeckLine[],
  rules: Readonly<Record<string, CardRules>>,
): ProblemInWords[] {
  // A line whose rules haven't arrived can't be checked yet; the server's answer brings them.
  const checkable = lines.filter((line) => rules[line.oracleId] !== undefined);
  const owned = new Map(checkable.map((line) => [line.oracleId, line.owned]));
  const problems = deckProblems(
    {
      format,
      entries: checkable.map((line) => ({
        oracleId: line.oracleId,
        board: line.board,
        quantity: line.quantity,
        printingId: null,
        finish: null,
        heading: null,
        note: null,
      })),
    },
    (oracleId) => rules[oracleId],
    (oracleId) => owned.get(oracleId) ?? 0,
  );
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
): Color[] | null {
  const commanders = lines.filter((line) => line.board === "commander");
  if (format !== "commander" || commanders.length === 0) return null;
  const colors = new Set(commanders.flatMap((line) => rules[line.oracleId]?.colorIdentity ?? []));
  return (["W", "U", "B", "R", "G"] as const).filter((color) => colors.has(color));
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
