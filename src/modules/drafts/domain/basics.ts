import type { Color, Finish, PrintingId } from "@/modules/catalog";
import { shuffled, type Rng, type UserId } from "@/shared/kernel";
import type { HandedOutBasic, OpenedPack } from "./draft";

// Basic lands (design doc 17, rules 15 and 17). Nobody drafts a Forest: the basics are taken out
// of the packs when they're opened and dealt out evenly and at random to the players. A draft deck
// then uses the basics a player owns, topped up for free when they're short, but never past 30.

type PackCard = Readonly<{ printingId: PrintingId; finish: Finish }>;

/** Splits opened packs into the packs without basics and the basics taken out of them. */
export function takeOutBasics(
  opened: ReadonlyArray<ReadonlyArray<OpenedPack>>,
  isBasic: (printingId: PrintingId) => boolean,
): { packs: OpenedPack[][]; basics: PackCard[] } {
  const basics: PackCard[] = [];
  const packs = opened.map((row) =>
    row.map((pack) => {
      basics.push(...pack.cards.filter((card) => isBasic(card.printingId)));
      return { ...pack, cards: pack.cards.filter((card) => !isBasic(card.printingId)) };
    }),
  );
  return { packs, basics };
}

/**
 * Deals basics like cards around a table: shuffle them, put the players in a random order, and
 * give one each in turn. Everyone gets the same number, give or take one, and who gets the spare
 * ones is random too. With nobody to deal to, the basics are dealt to no one.
 */
export function dealBasics(
  basics: readonly PackCard[],
  players: readonly UserId[],
  rng: Rng,
): HandedOutBasic[] {
  if (players.length === 0) return [];
  const order = shuffled(rng, players);
  return shuffled(rng, basics).map((card, index) => ({
    ...card,
    userId: order[index % order.length],
  }));
}

/** Free basics never take a player past this many of one basic land (rule 17). */
export const FREE_BASICS_CAP = 30;

/**
 * How many free copies of a basic land a player gets when their deck needs `needed` and they
 * own `owned`: enough to cover the deck, without owning more than `FREE_BASICS_CAP`.
 */
export function freeBasicsFor(needed: number, owned: number): number {
  return Math.max(0, Math.min(needed, FREE_BASICS_CAP) - owned);
}

/** Copies of one basic land a player owns. */
export type OwnedBasic = Readonly<{ printingId: PrintingId; finish: Finish; quantity: number }>;

type LandLine = Readonly<{ printingId: PrintingId; finish: Finish; quantity: number }>;

export type BasicLandPlan = Readonly<{
  /** The basics in the deck: the printing the player owns most of, else the draft set's. */
  deck: readonly LandLine[];
  /** The free basics to give so the player owns what the deck uses (never past 30). */
  free: readonly LandLine[];
}>;

const total = (copies: readonly OwnedBasic[]) =>
  copies.reduce((sum, copy) => sum + copy.quantity, 0);

/**
 * Turns the suggested build's basics ("10 Forests, 7 Islands") into deck lines and free copies
 * (rule 17). A color with no basic printing at all (a partly synced catalog) gives its lands to
 * the most-played color that has one, so the deck still has 40 cards.
 */
export function planBasicLands(
  wanted: ReadonlyArray<{ color: Color; count: number }>,
  owned: ReadonlyMap<Color, readonly OwnedBasic[]>,
  catalog: ReadonlyMap<Color, PrintingId>,
): BasicLandPlan {
  const hasPrinting = (color: Color) => (owned.get(color) ?? []).length > 0 || catalog.has(color);
  const fallback = [...wanted]
    .filter(({ color, count }) => count > 0 && hasPrinting(color))
    .sort((a, b) => b.count - a.count)[0]?.color;

  const counts = new Map<Color, number>();
  for (const { color, count } of wanted) {
    const target = hasPrinting(color) ? color : fallback;
    if (target === undefined || count === 0) continue;
    counts.set(target, (counts.get(target) ?? 0) + count);
  }

  const deck: LandLine[] = [];
  const free: LandLine[] = [];
  for (const [color, count] of counts) {
    const copies = [...(owned.get(color) ?? [])].sort((a, b) => b.quantity - a.quantity);
    const newPrinting = catalog.get(color) ?? copies[0]?.printingId;
    const shown =
      copies[0] ??
      (newPrinting === undefined
        ? undefined
        : { printingId: newPrinting, finish: "nonfoil" as const });
    if (shown === undefined) continue;
    deck.push({ printingId: shown.printingId, finish: shown.finish, quantity: count });
    const extra = freeBasicsFor(count, total(copies));
    if (extra > 0 && newPrinting !== undefined) {
      free.push({ printingId: newPrinting, finish: "nonfoil", quantity: extra });
    }
  }
  return { deck, free };
}
