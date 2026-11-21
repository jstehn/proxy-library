// Magic's vocabulary, shared by every module: card words, colours, card types and the mana curve,
// the tags and signals cards are sorted by, and the plain form of rules text. Pure, like the kernel
// (shared/kernel), and safe for the browser.
export { FINISHES, RARITIES } from "./card-words";
export type { Finish, Rarity } from "./card-words";
export {
  ColorSchema,
  FinishOrCheapestSchema,
  FinishSchema,
  ManaSymbolSchema,
  RaritySchema,
} from "./schemas";
export { COLORS, COLOR_COMBINATIONS, MANA_SYMBOLS, colorCombination } from "./colors";
export type { ColorCombination, ManaColor, ManaSymbol } from "./colors";
export { plainText } from "./plain-text";
export {
  BRACKET_FLAGS,
  SIGNAL_KINDS,
  TAGS,
  THEME_LABELS,
  THEMES,
  type BracketFlag,
  type SignalIO,
  type SignalKind,
  type Tag,
  type Theme,
} from "./card-vocabulary";
export {
  cardTypes,
  creatureTypes,
  hasTypeWord,
  isBasicLand,
  isCreature,
  isLand,
} from "./card-types";
export {
  CURVE_LAST_SLOT,
  CURVE_SLOTS,
  curveSlot,
  curveSlotLabel,
  manaCurve,
  type CurveLine,
} from "./mana-curve";
export type { CardTypes } from "./card-types";
export type { CardFacts, CardIdentity } from "./card-shapes";
