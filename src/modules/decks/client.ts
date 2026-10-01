// The decks module's browser-safe public API (ADR 0016): pure domain code for client components.
// Server code imports index.ts instead.
export {
  colorPips,
  deckStats,
  isLand,
  MANA_COLORS,
  mainType,
  suggestedLands,
  TYPE_ORDER,
  type DeckStats,
  type ManaColor,
  type ManaSource,
  type StatsLine,
} from "./domain/stats";
export { hasTerm, toggleTerm } from "./domain/search";
