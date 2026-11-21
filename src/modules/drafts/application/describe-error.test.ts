import { describe, expect, it } from "vitest";
import { Cents } from "@/shared/kernel";
import { describeDraftError, type DraftError } from "./describe-error";

describe("describeDraftError", () => {
  const sentences: ReadonlyArray<readonly [DraftError, string]> = [
    [{ kind: "DraftNotFound" }, "That draft doesn't exist."],
    [{ kind: "DraftNotOpen" }, "That draft has already started or closed."],
    [{ kind: "DraftNotRunning" }, "That draft isn't running."],
    [{ kind: "DraftNotFinished" }, "The draft isn't finished yet."],
    [{ kind: "DraftFull", maxSeats: 8 }, "That draft is full (8 players)."],
    [
      { kind: "AlreadyInADraft", draftId: 3 },
      "You're already in a draft. Finish or leave it first.",
    ],
    [{ kind: "NotSeated" }, "You're not playing in that draft."],
    [{ kind: "NotHost" }, "Only the host can do that."],
    [{ kind: "TooFewPlayers", minimum: 2 }, "A draft needs at least 2 players."],
    [{ kind: "StalePick" }, "That pick is out of date: here's your pack now."],
    [{ kind: "NotAway" }, "That player is still here. Give them a moment."],
    [{ kind: "NothingToPick" }, "That player has no pack waiting."],
    [{ kind: "SeatsInvalid", minimum: 2, maximum: 8 }, "A draft seats 2 to 8 players."],
    [
      { kind: "TimerInvalid", minimum: 10, maximum: 300 },
      "The pick timer must be 10 to 300 seconds, or off.",
    ],
    [{ kind: "BoosterNotDraftable" }, "That booster can't be drafted."],
    [
      { kind: "PriceUnavailable" },
      "The store has no price for that booster, so there's no entry fee to charge.",
    ],
    [
      { kind: "InsufficientFunds", balance: Cents.of(500), required: Cents.of(1250) },
      "You have $5.00; the entry fee is $12.50.",
    ],
    [{ kind: "BotsForAdminsOnly" }, "Only an admin hosting the lobby can add bots."],
    [{ kind: "BotNotFound" }, "That bot has already left."],
    [{ kind: "AwaitingChoices" }, "First make your choices about the card you drew."],
    [{ kind: "ChooseColorsFirst" }, "First choose the color you owe."],
    [{ kind: "MustDraftAtRandom" }, "Your Archdemon of Paliano is face up: you draft at random."],
    [{ kind: "AbilityUnavailable", reason: "it was used" }, "You can't do that now: it was used."],
    [{ kind: "NothingToAnswer" }, "There's nothing waiting for your answer."],
    [
      { kind: "CardNoLongerOwned" },
      "That card isn't in your collection any more, so it can't change hands.",
    ],
    [
      { kind: "LorePackUnavailable", reason: "no such pack" },
      "That pack can't be added: no such pack.",
    ],
    [
      { kind: "TooManyDecks", maximum: 100 },
      "You have 100 decks, the most allowed. Delete one first.",
    ],
  ];

  it.each(sentences)("says what %j means", (error, sentence) => {
    expect(describeDraftError(error)).toBe(sentence);
  });
});
