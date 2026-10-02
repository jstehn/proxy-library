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
/** Bots are a testing tool: only an admin hosting the lobby can add them. */
export type BotsForAdminsOnly = Readonly<{ kind: "BotsForAdminsOnly" }>;
export type BotNotFound = Readonly<{ kind: "BotNotFound" }>;
/** A card drafted at random is waiting for the player's choices about it (Archdemon). */
export type AwaitingChoices = Readonly<{ kind: "AwaitingChoices" }>;
/** The player owes a color choice (Paliano, Regicide) before they can draft again. */
export type ChooseColorsFirst = Readonly<{ kind: "ChooseColorsFirst" }>;
/** A face-up Archdemon of Paliano: this pick has to be at random. */
export type MustDraftAtRandom = Readonly<{ kind: "MustDraftAtRandom" }>;
/** A choice the player can't make now (no such face-up card, not enough cards left, …). */
export type AbilityUnavailable = Readonly<{ kind: "AbilityUnavailable"; reason: string }>;
/** Nothing to choose: no prompt, no such deal step, or not this player's to answer. */
export type NothingToAnswer = Readonly<{ kind: "NothingToAnswer" }>;
/** A card that must leave a player's collection (a Librarian put back, a Deal Broker swap) is gone. */
export type CardNoLongerOwned = Readonly<{ kind: "CardNoLongerOwned" }>;
/** A Lore Seeker's pack couldn't be added: not an unopened pack of yours, no price, no recipe. */
export type LorePackUnavailable = Readonly<{ kind: "LorePackUnavailable"; reason: string }>;
