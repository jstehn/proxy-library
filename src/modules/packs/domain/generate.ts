import type { BoosterConfig, BoosterSheet, Color, PrintingId } from "@/modules/catalog";
import { seededRng, weightedPick, weightedSample, type Rng, type Weighted } from "@/shared/kernel";
import { finishFor, type FactsLookup, type Pack, type PackCard } from "./pack";
import { revealOrder } from "./reveal";

// Turning a booster recipe into cards (design doc 05, section 3). Pure: all randomness comes
// from the Rng passed in, so the same seed always gives the same pack (rule 1).

/** Draws `count` printings from one sheet. */
type DrawSheet = (rng: Rng, sheet: BoosterSheet, count: number, facts: FactsLookup) => PrintingId[];

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

/**
 * Which card a printing is, for telling repeats apart: its name. Two versions of one card (the
 * regular one and its showcase art) are the same card. Basic lands are each their own, since
 * they may repeat.
 */
function cardIdentity(printingId: PrintingId, facts: FactsLookup): string {
  const printing = facts(printingId);
  return printing.isBasicLand ? `basic:${printingId}` : `name:${printing.name}`;
}

/**
 * Weighted sampling without replacement: `count` different cards, and never two versions of one
 * card (rule 3), e.g. a regular and a showcase Oblivious Bookworm from one foil uncommon slot.
 * A sheet with too few different cards for the slot falls back to different printings.
 */
function drawDistinct(
  rng: Rng,
  sheet: BoosterSheet,
  count: number,
  facts: FactsLookup,
): PrintingId[] {
  let remaining = weightedCards(sheet).filter((option) => option.weight > 0);
  const identities = new Set(remaining.map((option) => cardIdentity(option.item, facts)));
  if (identities.size < count) return weightedSample(rng, weightedCards(sheet), count);

  const drawn: PrintingId[] = [];
  for (let index = 0; index < count; index++) {
    const printingId = weightedPick(rng, remaining);
    drawn.push(printingId);
    const identity = cardIdentity(printingId, facts);
    remaining = remaining.filter((option) => cardIdentity(option.item, facts) !== identity);
  }
  return drawn;
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

  let drawn = draw(rng, sheet, count, facts);
  if (!isPossible) return drawn;
  for (let attempt = 1; attempt < COLOR_BALANCE_ATTEMPTS; attempt++) {
    if (monoColors(drawn, facts).size === ALL_COLORS.length) break;
    drawn = draw(rng, sheet, count, facts);
  }
  return drawn;
}

const LOW_RARITIES = new Set(["common", "uncommon"]);
const HIGH_RARITIES = new Set(["rare", "mythic"]);
const anyRarityCache = new WeakMap<BoosterSheet, boolean>();

/**
 * Whether a sheet is an "any rarity" slot, like a wildcard or a traditional foil: its cards
 * include both commons or uncommons and rares or mythics. Decided by what's on the sheet rather
 * than its name, because MTGJSON's sheet names differ from set to set.
 */
export function isAnyRaritySheet(sheet: BoosterSheet, facts: FactsLookup): boolean {
  const cached = anyRarityCache.get(sheet);
  if (cached !== undefined) return cached;
  const rarities = new Set(sheet.cards.map((card) => facts(card.printingId).rarity));
  const anyRarity =
    [...rarities].some((rarity) => LOW_RARITIES.has(rarity)) &&
    [...rarities].some((rarity) => HIGH_RARITIES.has(rarity));
  anyRarityCache.set(sheet, anyRarity);
  return anyRarity;
}

/**
 * Whether a sheet must avoid cards other slots already gave (rule 3b). Slots of one rarity
 * (commons, uncommons, the rare slot, a common-or-uncommon slot, lands) never repeat each
 * other, as in real packs. Any-rarity slots may repeat a card, as real wildcards and foils do,
 * a fixed sheet is an exact printed list, and basic lands may always repeat.
 */
export function avoidsRepeats(sheet: BoosterSheet, facts: FactsLookup): boolean {
  return !sheet.isFixed && !isAnyRaritySheet(sheet, facts);
}

/** A card in a finish: the same printing as a foil and as a nonfoil are different cards here. */
export function repeatKey(printingId: PrintingId, sheet: BoosterSheet): string {
  return `${printingId}/${sheet.isFoil ? "foil" : "regular"}`;
}

/**
 * The sheet without the cards already given, unless too few would be left for the draw (then
 * the whole sheet, so a tiny sheet still fills its slots).
 */
function withoutGiven(
  sheet: BoosterSheet,
  count: number,
  given: ReadonlySet<string>,
): BoosterSheet {
  const remaining = sheet.cards.filter(
    (card) => !given.has(repeatKey(card.printingId, sheet)) && card.weight > 0,
  );
  const enough = sheet.allowDuplicates ? remaining.length > 0 : remaining.length >= count;
  return enough ? { ...sheet, cards: remaining } : sheet;
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
  /** Cards the slots of one rarity (and fixed lists) have given so far (rule 3b). */
  const given = new Set<string>();
  // Fixed lists first (they're exact, so later slots can avoid their cards), then the rest. Each
  // group in name order, so how the recipe's JSON happens to order its keys (Postgres reorders
  // them) can never change which cards a seed produces.
  const byName = Object.keys(variant.slots).sort();
  const isFixedSheet = (name: string) => config.sheets[name]?.isFixed === true;
  const sheetNames = [
    ...byName.filter(isFixedSheet),
    ...byName.filter((name) => !isFixedSheet(name)),
  ];
  for (const sheetName of sheetNames) {
    const count = variant.slots[sheetName];
    const sheet = config.sheets[sheetName];
    if (sheet === undefined) {
      throw new Error(`${config.setCode}/${config.boosterType}: no sheet named "${sheetName}"`);
    }
    const draw = DRAW_STRATEGIES[sheetKind(sheet)];
    const drawable = avoidsRepeats(sheet, facts) ? withoutGiven(sheet, count, given) : sheet;
    const printingIds = drawable.balanceColors
      ? drawBalanced(draw, rng, drawable, count, facts)
      : draw(rng, drawable, count, facts);
    if (!isAnyRaritySheet(sheet, facts)) {
      for (const printingId of printingIds) {
        // Basic lands repeat in real packs (a Jumpstart pack has several of each).
        if (!facts(printingId).isBasicLand) given.add(repeatKey(printingId, sheet));
      }
    }

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
