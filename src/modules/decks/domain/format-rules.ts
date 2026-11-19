// The one place that knows how formats differ (refactor P10). Every other file asks a question of
// a format's rule set (`formatRules(format).hasCommandZone`) and never compares a format's name:
// the lint rule in eslint.config.mjs enforces that. The table below is `satisfies
// Record<Format, FormatRuleSet>`, so adding a format does not compile until every rule is filled in.
// Pure, and safe for the browser (it only imports types).

import type { Format } from "./deck";
import type { TargetedTag } from "./stats";

export type DeckSize = Readonly<{ cards: number; exact: boolean }>;
export type RoleTargets = Readonly<Record<TargetedTag, number>>;

export type FormatRuleSet = Readonly<{
  // Size
  /** How many cards a deck aims for: exactly that many when `exact`, otherwise at least. */
  deckSize: DeckSize;
  /** Whether a short main deck is reported as a problem (Casual has no minimum to enforce). */
  reportsShortDeck: boolean;
  /** The sideboard's maximum, or null when the format has none. */
  sideboardSize: number | null;
  /** The usual land count to aim for. */
  suggestedLands: number;
  /** Whether the land target moves with the curve (Limited decks keep the usual count). */
  landTargetFollowsCurve: boolean;

  // Copies
  /** The most copies the rules allow (reported as a problem), or null for no limit. */
  copyLimit: number | null;
  /** The most copies the automatic builders and suggestions take of one card. */
  plannedCopyLimit: number;
  /** Whether the deck is built from the cards the player owns, in any number (a draft pool). */
  buildsFromOwnedPool: boolean;

  // Legality and the command zone
  /** Whether a card must be legal in the format (Casual and Limited accept any card). */
  legalityChecked: boolean;
  hasCommandZone: boolean;
  /** Extra generic mana each time a commander is cast again. */
  commandZoneTaxPerCast: number;
  /** Whether the commanders' colors limit the deck's cards. */
  usesColorIdentity: boolean;
  /** Whether Commander brackets (and the combos behind them) apply. */
  bracketsApply: boolean;
  /** Whether conspiracies start in the command zone and so don't count towards the deck's size. */
  conspiraciesLeaveDeck: boolean;

  // Playing
  freeFirstMulligan: boolean;

  // Guides
  /** Role counts to aim for, or null when the pool decides (Limited). */
  roleTargets: RoleTargets | null;
  /** What the role targets are called on screen ("Commander", "60-card"). */
  roleGuideName: string;
  /** Average non-land mana value above which a curve counts as high. */
  curveGuide: number;
  /** The average mana value the optimizer scores a curve against. */
  optimizerTargetManaValue: number;
  /** How many cards fill one role slot before more of that role stop helping. */
  roleSlotSaturation: number;

  // Offered tools
  /** Whether "Draft deck" (the automatic fill) is offered. */
  canDraftDeck: boolean;
  /** Whether "which 60-card formats is this deck legal in" is worth asking. */
  hasConstructedVariants: boolean;
}>;

const COMMANDER_ROLE_TARGETS: RoleTargets = { ramp: 10, draw: 10, removal: 8, wipe: 3 };
const SIXTY_CARD_ROLE_TARGETS: RoleTargets = { ramp: 4, draw: 6, removal: 6, wipe: 2 };

/** What every 60-card format shares; the formats below change only what they differ in. */
const SIXTY_CARD_FORMAT = {
  deckSize: { cards: 60, exact: false },
  reportsShortDeck: true,
  sideboardSize: 15,
  suggestedLands: 24,
  landTargetFollowsCurve: true,
  copyLimit: 4,
  plannedCopyLimit: 4,
  buildsFromOwnedPool: false,
  legalityChecked: true,
  hasCommandZone: false,
  commandZoneTaxPerCast: 0,
  usesColorIdentity: false,
  bracketsApply: false,
  conspiraciesLeaveDeck: false,
  freeFirstMulligan: false,
  roleTargets: SIXTY_CARD_ROLE_TARGETS,
  roleGuideName: "60-card",
  curveGuide: 3.0,
  optimizerTargetManaValue: 2.4,
  roleSlotSaturation: 12,
  canDraftDeck: true,
  hasConstructedVariants: true,
} as const satisfies FormatRuleSet;

export const FORMAT_RULES = {
  casual: {
    ...SIXTY_CARD_FORMAT,
    reportsShortDeck: false,
    sideboardSize: null,
    copyLimit: null,
    legalityChecked: false,
  },
  standard: SIXTY_CARD_FORMAT,
  pioneer: SIXTY_CARD_FORMAT,
  modern: SIXTY_CARD_FORMAT,
  legacy: SIXTY_CARD_FORMAT,
  vintage: SIXTY_CARD_FORMAT,
  pauper: SIXTY_CARD_FORMAT,
  commander: {
    ...SIXTY_CARD_FORMAT,
    deckSize: { cards: 100, exact: true },
    sideboardSize: null,
    suggestedLands: 37,
    copyLimit: 1,
    plannedCopyLimit: 1,
    hasCommandZone: true,
    commandZoneTaxPerCast: 2,
    usesColorIdentity: true,
    bracketsApply: true,
    freeFirstMulligan: true,
    roleTargets: COMMANDER_ROLE_TARGETS,
    roleGuideName: "Commander",
    curveGuide: 3.3,
    optimizerTargetManaValue: 3.1,
    roleSlotSaturation: 20,
    hasConstructedVariants: false,
  },
  // Draft and sealed: 40 cards, as many copies as you opened, any card (design doc 17).
  limited: {
    ...SIXTY_CARD_FORMAT,
    deckSize: { cards: 40, exact: false },
    sideboardSize: null,
    suggestedLands: 17,
    landTargetFollowsCurve: false,
    copyLimit: null,
    buildsFromOwnedPool: true,
    legalityChecked: false,
    conspiraciesLeaveDeck: true,
    roleTargets: null,
    canDraftDeck: false,
    hasConstructedVariants: false,
  },
} as const satisfies Record<Format, FormatRuleSet>;

/** The rules of a format. A name that isn't a format (an old row, a typo) gets Casual's. */
export function formatRules(format: string): FormatRuleSet {
  return Object.hasOwn(FORMAT_RULES, format) ? FORMAT_RULES[format as Format] : FORMAT_RULES.casual;
}
