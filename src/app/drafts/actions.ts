"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SetCode } from "@/modules/catalog";
import {
  DraftId,
  type AddBotError,
  type CreateDraftError,
  type JoinDraftError,
  type LeaveDraftError,
  type MakeDraftDeckError,
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
 * Picks a card. Called from the pick screen without leaving the page; a stale pick (a double
 * click, an old tab) just shows the pack as it is now.
 */
export async function pickAction(input: {
  draftId: number;
  packNumber: number;
  slot: number;
}): Promise<PickActionResult> {
  const actor = await requireActor();
  const result = await getContainer().drafts.makePick(actor, {
    draftId: DraftId.of(input.draftId),
    packNumber: input.packNumber,
    slot: input.slot,
  });
  refreshDraftPages(input.draftId);
  if (result.ok || result.error.kind === "StalePick") return { error: null };
  return { error: errorMessage(result.error) };
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
