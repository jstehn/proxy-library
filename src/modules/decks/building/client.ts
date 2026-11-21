// The pure code of decks/building that the other areas, the module root and the browser use (ADR 0016, 0029).
export type { DeckAuditReport } from "./domain/audit-report";
export type { BrowseCard } from "./domain/browse-card";
export type {
  DeckDraft,
  DraftOptions,
  DraftReason,
  DraftedSpell,
} from "./domain/build-from-collection";
export {
  COMMANDER_SORTS,
  SPELL_SLOTS,
  type CommanderCoverage,
  type CommanderPlan,
  type CommanderSort,
} from "./domain/commanders";
export {
  landTarget,
  type LandReason,
  type LandTargetReason,
  type ManaBasePlan,
  type ManaBasePlanWithCastability,
  type PlannedLand,
} from "./domain/mana-base";
export type { SynergyQuery } from "./domain/search-for-deck";
export type {
  BudgetReplacementsResult,
  Suggestion,
  SuggestionCard,
  SuggestionList,
} from "./domain/suggestion-types";
