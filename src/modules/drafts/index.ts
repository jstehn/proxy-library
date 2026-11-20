// The drafts module's public API: the only file other modules and the app may import.
export {
  makeDrafts,
  type AddBotError,
  type AnswerError,
  type CreateDraftError,
  type DealAnswer,
  type EndDealsError,
  type PickChoices,
  type Drafts,
  type JoinDraftError,
  type LeaveDraftError,
  type MakeDraftDeckError,
  type PickError,
  type PickForAwayError,
  type RemoveBotError,
  type StartDraftError,
} from "./application/drafts";
export type { DraftsServices } from "./application/ports";
export { removeFromLobbies } from "./application/remove-from-lobbies";

export { DEFAULT_PICK_SECONDS, DraftId, MAX_SEATS, MIN_SEATS, type Draft } from "./domain/draft";
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
export type { DraftSummary, DraftView, SeatView } from "./queries/drafts";
export * as draftQueries from "./queries";
