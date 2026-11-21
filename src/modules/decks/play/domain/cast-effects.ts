import type { ManaSymbol } from "@/shared/mtg";
import { isManaSymbol, parseCost, type PaymentSource, type Pip } from "@/modules/decks/core/client";
import type { LibraryCard } from "./opening-hand/library";

// The cast simulator's effect registry (P28): what a card does to mana or to costs. Four kinds
// only. A card gets an effect from `CARD_EFFECTS` (by name) or, for mana from a permanent, from
// the catalog's card features; every other card is simply not affected.

/** Ramp up to this mana value is cast ahead of the target. */
export const RAMP_MAX_MANA_VALUE = 4;

export type CardEffect =
  /** Cast from hand: pay `cost`, add `adds` (Dark Ritual: pay {B}, add {B}{B}{B}). */
  | Readonly<{ kind: "ritual"; cost: string; adds: readonly ManaSymbol[] }>
  /** In play: spells of these types cost `generic` less (an empty list means every spell). */
  | Readonly<{ kind: "reducer"; generic: number; spellTypes: readonly string[] }>
  /** In play: taps for `amount` mana of one of `colors`. */
  | Readonly<{ kind: "tapMana"; amount: number; colors: readonly ManaSymbol[] }>
  /** Cast from hand: a land of one of `colors` joins the battlefield (Rampant Growth). */
  | Readonly<{ kind: "landFetch"; entersTapped: boolean; colors: readonly ManaSymbol[] }>;

/** What the simulator needs to know about a land in play. */
export type LandInPlay = Pick<LibraryCard, "producedMana" | "tapMana">;

/** What a reducer needs to know about the spell being cast. */
export type SpellToCast = Readonly<{ typeLine: string }>;

type EffectKind = CardEffect["kind"];
type EffectOf<Kind extends EffectKind> = Extract<CardEffect, { kind: Kind }>;

type EffectHandler<Effect> = Readonly<{
  /** Generic mana taken off a spell's cost while the card is in play. */
  discount?: (effect: Effect, spell: SpellToCast) => number;
  /** The mana left after casting the card from hand, or null when it can't be paid. */
  resolve?: (effect: Effect, mana: readonly PaymentSource[]) => readonly PaymentSource[] | null;
  /** The mana the card adds each turn once in play. */
  produces?: (effect: Effect) => readonly PaymentSource[];
  /** The land the card puts onto the battlefield, one that adds a colour still missing if it can. */
  fetches?: (effect: Effect, missing: readonly Pip[]) => LandInPlay;
}>;

export const CAST_EFFECTS: { [Kind in EffectKind]: EffectHandler<EffectOf<Kind>> } = {
  ritual: { resolve: payRitual },
  reducer: {
    discount: (effect, spell) =>
      effect.spellTypes.length === 0 ||
      effect.spellTypes.some((type) => spell.typeLine.includes(type))
        ? effect.generic
        : 0,
  },
  tapMana: {
    produces: (effect) => Array.from({ length: effect.amount }, () => effect.colors),
  },
  landFetch: { fetches: fetchLand },
};

/** The fetched land: a basic of the first missing colour the effect allows, else its first colour. */
function fetchLand(effect: EffectOf<"landFetch">, missing: readonly Pip[]): LandInPlay {
  const wanted = effect.colors.find((color) => missing.some((pip) => pip.includes(color)));
  return { producedMana: [wanted ?? effect.colors[0]] };
}

/** Pays the ritual's cost from the pool and adds its mana. */
function payRitual(
  effect: EffectOf<"ritual">,
  mana: readonly PaymentSource[],
): readonly PaymentSource[] | null {
  const { pips, generic } = parseCost(effect.cost);
  // Sources with the fewest colours pay first, so a dual source is kept for what needs it.
  const left = [...mana].sort((a, b) => a.length - b.length);
  for (const pip of pips) {
    const index = left.findIndex((source) => pip.some((color) => source.includes(color)));
    if (index === -1) return null;
    left.splice(index, 1);
  }
  if (left.length < generic) return null;
  left.splice(0, generic);
  return [...left, ...effect.adds.map((color): PaymentSource => [color])];
}

const ARTIFACT_REDUCER: EffectOf<"reducer"> = {
  kind: "reducer",
  generic: 1,
  spellTypes: ["Artifact"],
};

/** Cards with a known effect, by lowercase name. Others can be added here. */
const CARD_EFFECTS: Readonly<Record<string, CardEffect>> = {
  "dark ritual": { kind: "ritual", cost: "{B}", adds: ["B", "B", "B"] },
  "seething song": { kind: "ritual", cost: "{2}{R}", adds: ["R", "R", "R", "R", "R"] },
  "foundry inspector": ARTIFACT_REDUCER,
  "etherium sculptor": ARTIFACT_REDUCER,
  "goblin electromancer": { kind: "reducer", generic: 1, spellTypes: ["Instant", "Sorcery"] },
};

/** The colours a card taps for: its own, or colourless when it lists none. */
export function colorsOf(card: LandInPlay): readonly ManaSymbol[] {
  const colors = (card.producedMana ?? []).map((color) => color.toUpperCase()).filter(isManaSymbol);
  return colors.length > 0 ? colors : ["C"];
}

/** The effect a card has when cast, or undefined when it is not affected. */
export function effectOf(card: LibraryCard): CardEffect | undefined {
  const named = CARD_EFFECTS[card.name.trim().toLowerCase()];
  if (named !== undefined) return named;
  if (!card.isLand && card.landFetch != null && card.tags.includes("ramp")) {
    return { kind: "landFetch", ...card.landFetch };
  }
  const tap = card.tapMana;
  if (!card.isLand && tap?.isSource && (card.manaValue ?? 99) <= RAMP_MAX_MANA_VALUE) {
    return { kind: "tapMana", amount: Math.max(1, tap.amount), colors: colorsOf(card) };
  }
  return undefined;
}

/** The generic mana these effects, once in play, take off the spell. */
export function totalDiscount(effects: readonly CardEffect[], spell: SpellToCast): number {
  return effects.reduce(
    (sum, effect) =>
      sum + (effect.kind === "reducer" ? (CAST_EFFECTS.reducer.discount?.(effect, spell) ?? 0) : 0),
    0,
  );
}

/** The mana left after casting a ritual, or null when it can't be paid or the effect is no ritual. */
export function castRitual(
  effect: CardEffect,
  mana: readonly PaymentSource[],
): readonly PaymentSource[] | null {
  return effect.kind === "ritual" ? (CAST_EFFECTS.ritual.resolve?.(effect, mana) ?? null) : null;
}

/** The mana a card in play adds each turn. */
export function producedBy(effect: CardEffect): readonly PaymentSource[] {
  return effect.kind === "tapMana" ? (CAST_EFFECTS.tapMana.produces?.(effect) ?? []) : [];
}
