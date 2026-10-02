"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SetCode } from "@/modules/catalog";
import {
  DraftId,
  type AddBotError,
  type AnswerError,
  type CardRef,
  type CreateDraftError,
  type DealAnswer,
  type EndDealsError,
  type JoinDraftError,
  type LeaveDraftError,
  type MakeDraftDeckError,
  type PickChoices,
  type PickError,
  type PickForAwayError,
  type RemoveBotError,
  type StartDraftError,
} from "@/modules/drafts";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { assertNever, Cents } from "@/shared/kernel";

// Controllers for the draft pages (design doc 17): read the form, call the use case, and show
// the outcome. No rules live here.

type DraftError =
  | CreateDraftError
  | JoinDraftError
  | LeaveDraftError
  | StartDraftError
  | PickError
  | PickForAwayError
  | AnswerError
  | EndDealsError
  | MakeDraftDeckError
  | AddBotError
  | RemoveBotError;

function errorMessage(error: DraftError): string {
  switch (error.kind) {
    case "DraftNotFound":
      return "That draft doesn't exist.";
    case "DraftNotOpen":
      return "That draft has already started or closed.";
    case "DraftNotRunning":
      return "That draft isn't running.";
    case "DraftNotFinished":
      return "The draft isn't finished yet.";
    case "DraftFull":
      return `That draft is full (${error.maxSeats} players).`;
    case "AlreadyInADraft":
      return "You're already in a draft. Finish or leave it first.";
    case "NotSeated":
      return "You're not playing in that draft.";
    case "NotHost":
      return "Only the host can do that.";
    case "TooFewPlayers":
      return `A draft needs at least ${error.minimum} players.`;
    case "StalePick":
      return "That pick is out of date: here's your pack now.";
    case "NotAway":
      return "That player is still here. Give them a moment.";
    case "NothingToPick":
      return "That player has no pack waiting.";
    case "SeatsInvalid":
      return `A draft seats ${error.minimum} to ${error.maximum} players.`;
    case "TimerInvalid":
      return `The pick timer must be ${error.minimum} to ${error.maximum} seconds, or off.`;
    case "BoosterNotDraftable":
      return "That booster can't be drafted.";
    case "PriceUnavailable":
      return "The store has no price for that booster, so there's no entry fee to charge.";
    case "InsufficientFunds":
      return `You have ${Cents.format(error.balance)}; the entry fee is ${Cents.format(error.required)}.`;
    case "BotsForAdminsOnly":
      return "Only an admin hosting the lobby can add bots.";
    case "BotNotFound":
      return "That bot has already left.";
    case "AwaitingChoices":
      return "First make your choices about the card you drew.";
    case "ChooseColorsFirst":
      return "First choose the color you owe.";
    case "MustDraftAtRandom":
      return "Your Archdemon of Paliano is face up: you draft at random.";
    case "AbilityUnavailable":
      return `You can't do that now: ${error.reason}.`;
    case "NothingToAnswer":
      return "There's nothing waiting for your answer.";
    case "CardNoLongerOwned":
      return "That card isn't in your collection any more, so it can't change hands.";
    case "LorePackUnavailable":
      return `That pack can't be added: ${error.reason}.`;
    case "TooManyDecks":
      return `You have ${error.maximum} decks, the most allowed. Delete one first.`;
    default:
      return assertNever(error);
  }
}

function draftIdFrom(formData: FormData): DraftId {
  const raw = Number(formData.get("draftId"));
  if (!Number.isSafeInteger(raw) || raw <= 0) redirect("/drafts");
  return DraftId.of(raw);
}

function backTo(path: string, error: DraftError): never {
  redirect(`${path}?error=${encodeURIComponent(errorMessage(error))}`);
}

function refreshDraftPages(draftId: number) {
  revalidatePath("/drafts");
  revalidatePath(`/drafts/${draftId}`);
  revalidatePath("/", "layout"); // the balance and the header's draft reminder
}

export async function createDraftAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const [setCode, boosterType] = String(formData.get("booster") ?? "").split("/");
  const timer = String(formData.get("secondsPerPick") ?? "");
  if (!setCode || !boosterType) redirect("/drafts?error=Choose+a+set+to+draft.");
  const result = await getContainer().drafts.createDraft(actor, {
    setCode: SetCode.of(setCode),
    boosterType,
    maxSeats: Number(formData.get("maxSeats")),
    secondsPerPick: timer === "off" ? null : Number(timer),
  });
  if (!result.ok) backTo("/drafts", result.error);
  refreshDraftPages(result.value);
  redirect(`/drafts/${result.value}`);
}

export async function joinDraftAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draftId = draftIdFrom(formData);
  const result = await getContainer().drafts.joinDraft(actor, draftId);
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
  redirect(`/drafts/${draftId}`);
}

export async function leaveDraftAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draftId = draftIdFrom(formData);
  const result = await getContainer().drafts.leaveDraft(actor, draftId);
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
  redirect("/drafts");
}

export async function startDraftAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draftId = draftIdFrom(formData);
  const result = await getContainer().drafts.startDraft(actor, draftId);
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

export type PickActionResult = { error: string | null };

/**
 * Drafts a card, with the player's choices about it (design doc 18). Called from the pick screen
 * without leaving the page; a stale pick (a double click, an old tab) just shows the pack as it
 * is now.
 */
export async function pickAction(input: {
  draftId: number;
  packNumber: number;
  slot: number | "random";
  choices: PickChoices;
}): Promise<PickActionResult> {
  const actor = await requireActor();
  const result = await getContainer().drafts.makePick(actor, {
    draftId: DraftId.of(input.draftId),
    packNumber: input.packNumber,
    slot: input.slot,
    choices: input.choices,
  });
  refreshDraftPages(input.draftId);
  if (result.ok || result.error.kind === "StalePick") return { error: null };
  return { error: errorMessage(result.error) };
}

/** The choices about a card drawn at random (Archdemon of Paliano). */
export async function decideAction(input: {
  draftId: number;
  choices: PickChoices;
}): Promise<PickActionResult> {
  const actor = await requireActor();
  const result = await getContainer().drafts.decideCard(actor, {
    draftId: DraftId.of(input.draftId),
    choices: input.choices,
  });
  refreshDraftPages(input.draftId);
  return { error: result.ok ? null : errorMessage(result.error) };
}

const COLOR_VALUES = ["W", "U", "B", "R", "G"] as const;

/** A color the player owes (Paliano, the High City; Regicide). */
export async function chooseColorAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draftId = draftIdFrom(formData);
  const color = COLOR_VALUES.find((each) => each === formData.get("color"));
  if (color === undefined) redirect(`/drafts/${draftId}`);
  const result = await getContainer().drafts.chooseColor(actor, { draftId, color });
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

/** "12:3" (pack 12, slot 3) from a form field, or null for "none". */
function cardFrom(value: FormDataEntryValue | null): CardRef | null {
  const match = /^(\d+):(\d+)$/.exec(String(value ?? ""));
  return match === null ? null : { packNumber: Number(match[1]), slot: Number(match[2]) };
}

/** Whispergear Sneak: look at a pack. */
export async function sneakAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draftId = draftIdFrom(formData);
  const card = cardFrom(formData.get("card"));
  if (card === null) redirect(`/drafts/${draftId}`);
  const result = await getContainer().drafts.peekWithSneak(actor, {
    draftId,
    card,
    packNumber: Number(formData.get("packNumber")),
  });
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

/** Illusionary Informant: see the next card a player drafts. */
export async function informantAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draftId = draftIdFrom(formData);
  const card = cardFrom(formData.get("card"));
  if (card === null) redirect(`/drafts/${draftId}`);
  const result = await getContainer().drafts.watchWithInformant(actor, {
    draftId,
    card,
    targetSeat: Number(formData.get("targetSeat")),
  });
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

/** A Deal Broker step: reveal, offer (a card or nothing) or accept (an offer or none). */
export async function dealAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draftId = draftIdFrom(formData);
  const step = String(formData.get("step"));
  const answer: DealAnswer =
    step === "accept"
      ? {
          draftId,
          step: "accept",
          offerSeat:
            formData.get("offerSeat") === "none" ? null : Number(formData.get("offerSeat")),
        }
      : {
          draftId,
          step: step === "offer" ? "offer" : "reveal",
          card: cardFrom(formData.get("card")),
        };
  const result = await getContainer().drafts.answerDeal(actor, answer);
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

/** The host ends the deals (timer off, someone has gone). */
export async function endDealsAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draftId = draftIdFrom(formData);
  const result = await getContainer().drafts.endDeals(actor, draftId);
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

export async function pickForAwayAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draftId = draftIdFrom(formData);
  const result = await getContainer().drafts.pickForAway(actor, {
    draftId,
    seatNumber: Number(formData.get("seatNumber")),
  });
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

export async function makeDraftDeckAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draftId = draftIdFrom(formData);
  const result = await getContainer().drafts.makeDraftDeck(actor, draftId);
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  revalidatePath("/decks");
  redirect(`/decks/${result.value}`);
}

/** An admin hosting a lobby adds a bot, paying its entry fee (a testing tool). */
export async function addBotAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draftId = draftIdFrom(formData);
  const result = await getContainer().drafts.addBot(actor, draftId);
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

export async function removeBotAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draftId = draftIdFrom(formData);
  const result = await getContainer().drafts.removeBot(actor, {
    draftId,
    botNumber: Number(formData.get("botNumber")),
  });
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}
