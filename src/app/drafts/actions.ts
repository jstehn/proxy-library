"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SetCode } from "@/modules/catalog";
import {
  DraftId,
  describeDraftError,
  type CardRef,
  type DealAnswer,
  type DraftError,
  type PickChoices,
} from "@/modules/drafts";
import { readPage } from "@/server/page-instance";
import { COLORS } from "@/shared/kernel";

// Controllers for the draft pages (design doc 17): read the form, call the use case, and show
// the outcome. No rules live here.

function draftIdFrom(formData: FormData): DraftId {
  const raw = Number(formData.get("draftId"));
  if (!Number.isSafeInteger(raw) || raw <= 0) redirect("/drafts");
  return DraftId.of(raw);
}

function backTo(path: string, error: DraftError): never {
  redirect(`${path}?error=${encodeURIComponent(describeDraftError(error))}`);
}

function refreshDraftPages(draftId: number) {
  revalidatePath("/drafts");
  revalidatePath(`/drafts/${draftId}`);
  revalidatePath("/", "layout"); // the balance and the header's draft reminder
}

export async function createDraftAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const [setCode, boosterType] = String(formData.get("booster") ?? "").split("/");
  const timer = String(formData.get("secondsPerPick") ?? "");
  if (!setCode || !boosterType) redirect("/drafts?error=Choose+a+set+to+draft.");
  const result = await capabilities.drafts.createDraft(actor, {
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
  const { actor, capabilities } = await readPage();
  const draftId = draftIdFrom(formData);
  const result = await capabilities.drafts.joinDraft(actor, draftId);
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
  redirect(`/drafts/${draftId}`);
}

export async function leaveDraftAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const draftId = draftIdFrom(formData);
  const result = await capabilities.drafts.leaveDraft(actor, draftId);
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
  redirect("/drafts");
}

export async function startDraftAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const draftId = draftIdFrom(formData);
  const result = await capabilities.drafts.startDraft(actor, draftId);
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
  const { actor, capabilities } = await readPage();
  const result = await capabilities.drafts.makePick(actor, {
    draftId: DraftId.of(input.draftId),
    packNumber: input.packNumber,
    slot: input.slot,
    choices: input.choices,
  });
  refreshDraftPages(input.draftId);
  if (result.ok || result.error.kind === "StalePick") return { error: null };
  return { error: describeDraftError(result.error) };
}

/** The choices about a card drawn at random (Archdemon of Paliano). */
export async function decideAction(input: {
  draftId: number;
  choices: PickChoices;
}): Promise<PickActionResult> {
  const { actor, capabilities } = await readPage();
  const result = await capabilities.drafts.decideCard(actor, {
    draftId: DraftId.of(input.draftId),
    choices: input.choices,
  });
  refreshDraftPages(input.draftId);
  return { error: result.ok ? null : describeDraftError(result.error) };
}

/** A color the player owes (Paliano, the High City; Regicide). */
export async function chooseColorAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const draftId = draftIdFrom(formData);
  const color = COLORS.find((each) => each === formData.get("color"));
  if (color === undefined) redirect(`/drafts/${draftId}`);
  const result = await capabilities.drafts.chooseColor(actor, { draftId, color });
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
  const { actor, capabilities } = await readPage();
  const draftId = draftIdFrom(formData);
  const card = cardFrom(formData.get("card"));
  if (card === null) redirect(`/drafts/${draftId}`);
  const result = await capabilities.drafts.peekWithSneak(actor, {
    draftId,
    card,
    packNumber: Number(formData.get("packNumber")),
  });
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

/** Illusionary Informant: see the next card a player drafts. */
export async function informantAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const draftId = draftIdFrom(formData);
  const card = cardFrom(formData.get("card"));
  if (card === null) redirect(`/drafts/${draftId}`);
  const result = await capabilities.drafts.watchWithInformant(actor, {
    draftId,
    card,
    targetSeat: Number(formData.get("targetSeat")),
  });
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

/** A Deal Broker step: reveal, offer (a card or nothing) or accept (an offer or none). */
export async function dealAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
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
  const result = await capabilities.drafts.answerDeal(actor, answer);
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

/** The host ends the deals (timer off, someone has gone). */
export async function endDealsAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const draftId = draftIdFrom(formData);
  const result = await capabilities.drafts.endDeals(actor, draftId);
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

export async function pickForAwayAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const draftId = draftIdFrom(formData);
  const result = await capabilities.drafts.pickForAway(actor, {
    draftId,
    seatNumber: Number(formData.get("seatNumber")),
  });
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

export async function makeDraftDeckAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const draftId = draftIdFrom(formData);
  const result = await capabilities.drafts.makeDraftDeck(actor, draftId);
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  revalidatePath("/decks");
  redirect(`/decks/${result.value}`);
}

/** An admin hosting a lobby adds a bot, paying its entry fee (a testing tool). */
export async function addBotAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const draftId = draftIdFrom(formData);
  const result = await capabilities.drafts.addBot(actor, draftId);
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}

export async function removeBotAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const draftId = draftIdFrom(formData);
  const result = await capabilities.drafts.removeBot(actor, {
    draftId,
    botNumber: Number(formData.get("botNumber")),
  });
  if (!result.ok) backTo(`/drafts/${draftId}`, result.error);
  refreshDraftPages(draftId);
}
