// Shared kernel: tiny, stable, pure building blocks used by every module.
// Nothing here performs I/O. Real adapters live in shared/runtime and shared/db.
// Magic's own vocabulary (colours, card types, tags) is next door, in shared/mtg.
export { assertNever } from "./assert-never";
export { pick } from "./pick";
export type { Brand } from "./brand";
export type { Clock } from "./clock";
export { UserId } from "./ids";
export { Cents } from "./money";
export { ok, err } from "./result";
export type { Ok, Err, Result } from "./result";
export { seededRng, randomInt, shuffled, weightedPick, weightedSample } from "./rng";
export type { Rng, Weighted } from "./rng";
export {
  THEME_COOKIE_NAME,
  THEME_IDS,
  DEFAULT_THEME_PREFERENCE,
  isThemeId,
  checkThemeId,
  parseThemeCookie,
  serializeThemeCookie,
} from "./theme";
export type { ThemeError, ThemeId, ThemePreference } from "./theme";
export type { UnitOfWork } from "./unit-of-work";
