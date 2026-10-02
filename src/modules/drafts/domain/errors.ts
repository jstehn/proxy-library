// Every expected failure in the drafts module (design doc 17, section 5).
export type DraftNotFound = Readonly<{ kind: "DraftNotFound" }>;
/** The draft has already started, finished or been cancelled: lobby actions no longer apply. */
export type DraftNotOpen = Readonly<{ kind: "DraftNotOpen" }>;
/** Picking needs a draft that is running. */
export type DraftNotRunning = Readonly<{ kind: "DraftNotRunning" }>;
export type DraftNotFinished = Readonly<{ kind: "DraftNotFinished" }>;
export type DraftFull = Readonly<{ kind: "DraftFull"; maxSeats: number }>;
/** Rule 1: one unfinished draft per player. */
export type AlreadyInADraft = Readonly<{ kind: "AlreadyInADraft"; draftId: number }>;
export type NotSeated = Readonly<{ kind: "NotSeated" }>;
export type NotHost = Readonly<{ kind: "NotHost" }>;
export type TooFewPlayers = Readonly<{ kind: "TooFewPlayers"; minimum: number }>;
/** The pick names a pack or card that isn't at the front of your queue any more (rule 5). */
export type StalePick = Readonly<{ kind: "StalePick" }>;
/** The host asked to pick for a seat that is still connected. */
export type NotAway = Readonly<{ kind: "NotAway" }>;
/** The seat has no pack waiting. */
export type NothingToPick = Readonly<{ kind: "NothingToPick" }>;
export type SeatsInvalid = Readonly<{ kind: "SeatsInvalid"; minimum: number; maximum: number }>;
export type TimerInvalid = Readonly<{ kind: "TimerInvalid"; minimum: number; maximum: number }>;
/** Not a booster you can draft (collector boosters, a set that isn't enabled, …). */
export type BoosterNotDraftable = Readonly<{ kind: "BoosterNotDraftable" }>;
/** The store has no price for this booster, so there's no entry fee to charge. */
export type PriceUnavailable = Readonly<{ kind: "PriceUnavailable" }>;
