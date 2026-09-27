import type { BoosterConfig, BoosterSheet, Color, PrintingId } from "@/modules/catalog";
import { seededRng, weightedPick, weightedSample, type Rng, type Weighted } from "@/shared/kernel";
import { finishFor, type FactsLookup, type Pack, type PackCard } from "./pack";
import { revealOrder } from "./reveal";

// Turning a booster recipe into cards (design doc 05, section 3). Pure: all randomness comes
// from the Rng passed in, so the same seed always gives the same pack (rule 1).

/** Draws `count` printings from one sheet. */
type DrawSheet = (rng: Rng, sheet: BoosterSheet, count: number) => PrintingId[];

/** How a sheet is drawn from, decided by its flags. */
export type SheetKind = "fixed" | "withDuplicates" | "distinct";

export function sheetKind(sheet: BoosterSheet): SheetKind {
  if (sheet.isFixed) return "fixed";
  if (sheet.allowDuplicates) return "withDuplicates";
  return "distinct";
}

function weightedCards(sheet: BoosterSheet): Weighted<PrintingId>[] {
  return sheet.cards.map((card) => ({ item: card.printingId, weight: card.weight }));
}

/**
 * A fixed sheet isn't random: every card is included, `weight` times, in the listed order
 * (e.g. a beginner deck). If the slot asks for more or fewer cards, the list repeats or stops.
 */
function drawFixed(_rng: Rng, sheet: BoosterSheet, count: number): PrintingId[] {
  const everyCopy = sheet.cards.flatMap((card) =>
    Array.from({ length: card.weight }, () => card.printingId),
  );
  return Array.from({ length: count }, (_, index) => everyCopy[index % everyCopy.length]);
}

/** Each card is an independent weighted pick, so the same card can come up twice. */
function drawWithDuplicates(rng: Rng, sheet: BoosterSheet, count: number): PrintingId[] {
  return Array.from({ length: count }, () => weightedPick(rng, weightedCards(sheet)));
}

/** Weighted sampling without replacement: `count` different cards. */
function drawDistinct(rng: Rng, sheet: BoosterSheet, count: number): PrintingId[] {
  return weightedSample(rng, weightedCards(sheet), count);
}

/** The strategy for each kind of sheet (patterns.md: Strategy). */
const DRAW_STRATEGIES: Record<SheetKind, DrawSheet> = {
  fixed: drawFixed,
  withDuplicates: drawWithDuplicates,
  distinct: drawDistinct,
};

export const ALL_COLORS: readonly Color[] = ["W", "U", "B", "R", "G"];
export const COLOR_BALANCE_ATTEMPTS = 50;

/** The colors of the mono-colored cards among these printings. */
function monoColors(printingIds: readonly PrintingId[], facts: FactsLookup): Set<Color> {
  const colors = new Set<Color>();
  for (const printingId of printingIds) {
    const cardColors = facts(printingId).colors;
    if (cardColors.length === 1) colors.add(cardColors[0]);
  }
  return colors;
}

/**
 * Rejection sampling for color balance (rule 5): draw, and if some color is missing among the
 * mono-colored cards, throw the draw away and draw again. Redrawing keeps every card's
 * relative odds, which "swap a card in" would not. A sheet that can never show all five colors
 * keeps its first draw; one that is just unlucky gives up after COLOR_BALANCE_ATTEMPTS.
 */
function drawBalanced(
  draw: DrawSheet,
  rng: Rng,
  sheet: BoosterSheet,
  count: number,
  facts: FactsLookup,
): PrintingId[] {
  const sheetPrintings = sheet.cards.map((card) => card.printingId);
  const isPossible =
    count >= ALL_COLORS.length && monoColors(sheetPrintings, facts).size === ALL_COLORS.length;

  let drawn = draw(rng, sheet, count);
  if (!isPossible) return drawn;
  for (let attempt = 1; attempt < COLOR_BALANCE_ATTEMPTS; attempt++) {
    if (monoColors(drawn, facts).size === ALL_COLORS.length) break;
    drawn = draw(rng, sheet, count);
  }
  return drawn;
}

/** A generated pack before it's put in reveal order. */
export type GeneratedPack = Readonly<{ variantIndex: number; cards: readonly PackCard[] }>;

/** Recipe + Rng → the pack's cards. */
export function generatePack(config: BoosterConfig, rng: Rng, facts: FactsLookup): GeneratedPack {
  const variantIndex = weightedPick(
    rng,
    config.variants.map((variant, index) => ({ item: index, weight: variant.weight })),
  );
  const variant = config.variants[variantIndex];

  const cards: PackCard[] = [];
  // Slots are drawn in name order, so how the recipe's JSON happens to order its keys (Postgres
  // reorders them) can never change which cards a seed produces.
  const sheetNames = Object.keys(variant.slots).sort();
  for (const sheetName of sheetNames) {
    const count = variant.slots[sheetName];
    const sheet = config.sheets[sheetName];
    if (sheet === undefined) {
      throw new Error(`${config.setCode}/${config.boosterType}: no sheet named "${sheetName}"`);
    }
    const draw = DRAW_STRATEGIES[sheetKind(sheet)];
    const printingIds = sheet.balanceColors
      ? drawBalanced(draw, rng, sheet, count, facts)
      : draw(rng, sheet, count);

    for (const printingId of printingIds) {
      const finish = finishFor(sheetName, sheet, facts(printingId).finishes);
      cards.push({ printingId, finish, sheet: sheetName });
    }
  }
  return { variantIndex, cards };
}

/** Opens one pack from a seed: generate, then put the cards in reveal order. */
export function openPack(config: BoosterConfig, facts: FactsLookup, seed: string): Pack {
  const generated = generatePack(config, seededRng(seed), facts);
  return {
    setCode: config.setCode,
    boosterType: config.boosterType,
    seed,
    variantIndex: generated.variantIndex,
    cards: revealOrder(generated.cards, facts),
  };
}
