// Shared kernel: tiny, stable, pure building blocks used by every module.
// Nothing here performs I/O. Real adapters live in shared/runtime and shared/db.
export { assertNever } from "./assert-never";
export { pick } from "./pick";
export type { Brand } from "./brand";
export type { Clock } from "./clock";
export { UserId } from "./ids";
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
  TAGS,
  THEME_LABELS,
  THEMES,
  type BracketFlag,
  type Tag,
  type Theme,
} from "./card-vocabulary";
export { cardTypes, hasTypeWord, isBasicLand, isCreature, isLand } from "./card-types";
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
export { Cents } from "./money";
export { ok, err } from "./result";
export type { Ok, Err, Result } from "./result";
export { seededRng, randomInt, shuffled, weightedPick, weightedSample } from "./rng";
export type { Rng, Weighted } from "./rng";
export type { UnitOfWork } from "./unit-of-work";
