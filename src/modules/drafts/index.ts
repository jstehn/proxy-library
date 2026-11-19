// The drafts module's public API: the only file other modules and the app may import.
export {
  makeDrafts,
  type AddBotError,
  type AnswerError,
  type CreateDraftError,
  type DealAnswer,
  type EndDealsError,
  type LorePackSource,
  type PickChoices,
  type CreateDraftInput,
  type Drafts,
  type JoinDraftError,
  type LeaveDraftError,
  type MakeDraftDeckError,
  type PickError,
  type PickForAwayError,
  type PickInput,
  type RemoveBotError,
  type StartDraftError,
  type TimerReport,
} from "./application/drafts";
export type {
  DraftCatalog,
  DraftNotifier,
  DraftRepository,
  DraftsDependencies,
  DraftsServices,
} from "./application/ports";
export { removeFromLobbies } from "./application/remove-from-lobbies";
export type { DraftCardFacts } from "./domain/auto-pick";
export {
  DEFAULT_PICK_SECONDS,
  DraftId,
  MAX_SEATS,
  MIN_SEATS,
  type Draft,
  type DraftStatus,
  type NewDraft,
} from "./domain/draft";
export { guessedRight, type CardRef, type Note } from "./domain/abilities";
export type {
  DealSeen,
  DraftSeen,
  PickOptions,
  SeatSeen,
  SeenCard,
  YouSeen,
} from "./domain/visibility";
export type { Reveal } from "./domain/draft";
export {
  activeDraftOf,
  boosterOptions,
  draftableBoosters,
  draftsOverview,
  draftVersion,
  draftView,
  type BoosterOption,
  type DraftableBooster,
  type DraftStatusName,
  type DraftsOverview,
  type DraftSummary,
  type DraftView,
  type SeatView,
  type YourSeat,
} from "./queries/drafts";
