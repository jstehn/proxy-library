"use server";
import { z } from "zod";
import { SetCode } from "@/modules/catalog";
import {
  DraftId,
  describeDraftError,
  type CardRef,
  type DealAnswer,
  type DraftError,
  type PickChoices,
} from "@/modules/drafts";
import { formRedirect } from "@/server/form-action-instance";
import { readPage } from "@/server/page-instance";
import { COLORS } from "@/shared/mtg";
import { revalidateDeckList } from "../decks/paths";
import { DRAFTS_PATH, draftPath, revalidateDraft } from "./paths";

// Controllers for the draft pages (design doc 17): read the form, call the use case, and show
// the outcome. No rules live here. A form that can't be read goes back to the draft list.

const FORM_UNREADABLE = { unreadable: DRAFTS_PATH };

const DraftIdField = z.coerce
  .number()
  .int()
  .positive()
  .transform((raw) => DraftId.of(raw));
const DraftForm = z.object({ draftId: DraftIdField });

/** "12:3" (pack 12, slot 3) from a form field, or null for "none". */
const CardField = z
  .string()
  .default("")
  .transform((value): CardRef | null => {
    const match = /^(\d+):(\d+)$/.exec(value);
    return match === null ? null : { packNumber: Number(match[1]), slot: Number(match[2]) };
  });

function backTo(path: string, error: DraftError): string {
  return `${path}?error=${encodeURIComponent(describeDraftError(error))}`;
}

export const createDraftAction = formRedirect(
  z.object({
    booster: z.string().default(""),
    secondsPerPick: z.string().default(""),
    maxSeats: z.coerce.number(),
  }),
  async ({ actor, capabilities }, { booster, secondsPerPick, maxSeats }) => {
    const [setCode, boosterType] = booster.split("/");
    if (!setCode || !boosterType) return `${DRAFTS_PATH}?error=Choose+a+set+to+draft.`;
    const result = await capabilities.drafts.createDraft(actor, {
      setCode: SetCode.of(setCode),
      boosterType,
      maxSeats,
      secondsPerPick: secondsPerPick === "off" ? null : Number(secondsPerPick),
    });
    if (!result.ok) return backTo(DRAFTS_PATH, result.error);
    revalidateDraft(result.value);
    return draftPath(result.value);
  },
  FORM_UNREADABLE,
);

export const joinDraftAction = formRedirect(
  DraftForm,
  async ({ actor, capabilities }, { draftId }) => {
    const result = await capabilities.drafts.joinDraft(actor, draftId);
    if (!result.ok) return backTo(draftPath(draftId), result.error);
    revalidateDraft(draftId);
    return draftPath(draftId);
  },
  FORM_UNREADABLE,
);

export const leaveDraftAction = formRedirect(
  DraftForm,
  async ({ actor, capabilities }, { draftId }) => {
    const result = await capabilities.drafts.leaveDraft(actor, draftId);
    if (!result.ok) return backTo(draftPath(draftId), result.error);
    revalidateDraft(draftId);
    return DRAFTS_PATH;
  },
  FORM_UNREADABLE,
);

export const startDraftAction = formRedirect(
  DraftForm,
  async ({ actor, capabilities }, { draftId }) => {
    const result = await capabilities.drafts.startDraft(actor, draftId);
    if (!result.ok) return backTo(draftPath(draftId), result.error);
    revalidateDraft(draftId);
    return undefined;
  },
  FORM_UNREADABLE,
);

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
  revalidateDraft(input.draftId);
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
  revalidateDraft(input.draftId);
  return { error: result.ok ? null : describeDraftError(result.error) };
}

/** A color the player owes (Paliano, the High City; Regicide). */
export const chooseColorAction = formRedirect(
  z.object({ draftId: DraftIdField, color: z.enum(COLORS).optional().catch(undefined) }),
  async ({ actor, capabilities }, { draftId, color }) => {
    if (color === undefined) return draftPath(draftId);
    const result = await capabilities.drafts.chooseColor(actor, { draftId, color });
    if (!result.ok) return backTo(draftPath(draftId), result.error);
    revalidateDraft(draftId);
    return undefined;
  },
  FORM_UNREADABLE,
);

/** Whispergear Sneak: look at a pack. */
export const sneakAction = formRedirect(
  z.object({ draftId: DraftIdField, card: CardField, packNumber: z.coerce.number() }),
  async ({ actor, capabilities }, { draftId, card, packNumber }) => {
    if (card === null) return draftPath(draftId);
    const result = await capabilities.drafts.peekWithSneak(actor, { draftId, card, packNumber });
    if (!result.ok) return backTo(draftPath(draftId), result.error);
    revalidateDraft(draftId);
    return undefined;
  },
  FORM_UNREADABLE,
);

/** Illusionary Informant: see the next card a player drafts. */
export const informantAction = formRedirect(
  z.object({ draftId: DraftIdField, card: CardField, targetSeat: z.coerce.number() }),
  async ({ actor, capabilities }, { draftId, card, targetSeat }) => {
    if (card === null) return draftPath(draftId);
    const result = await capabilities.drafts.watchWithInformant(actor, {
      draftId,
      card,
      targetSeat,
    });
    if (!result.ok) return backTo(draftPath(draftId), result.error);
    revalidateDraft(draftId);
    return undefined;
  },
  FORM_UNREADABLE,
);

/** A Deal Broker step: reveal, offer (a card or nothing) or accept (an offer or none). */
export const dealAction = formRedirect(
  z.object({
    draftId: DraftIdField,
    step: z.string().default(""),
    offerSeat: z.string().optional(),
    card: CardField,
  }),
  async ({ actor, capabilities }, { draftId, step, offerSeat, card }) => {
    const answer: DealAnswer =
      step === "accept"
        ? { draftId, step: "accept", offerSeat: offerSeat === "none" ? null : Number(offerSeat) }
        : { draftId, step: step === "offer" ? "offer" : "reveal", card };
    const result = await capabilities.drafts.answerDeal(actor, answer);
    if (!result.ok) return backTo(draftPath(draftId), result.error);
    revalidateDraft(draftId);
    return undefined;
  },
  FORM_UNREADABLE,
);

/** The host ends the deals (timer off, someone has gone). */
export const endDealsAction = formRedirect(
  DraftForm,
  async ({ actor, capabilities }, { draftId }) => {
    const result = await capabilities.drafts.endDeals(actor, draftId);
    if (!result.ok) return backTo(draftPath(draftId), result.error);
    revalidateDraft(draftId);
    return undefined;
  },
  FORM_UNREADABLE,
);

export const pickForAwayAction = formRedirect(
  z.object({ draftId: DraftIdField, seatNumber: z.coerce.number() }),
  async ({ actor, capabilities }, { draftId, seatNumber }) => {
    const result = await capabilities.drafts.pickForAway(actor, { draftId, seatNumber });
    if (!result.ok) return backTo(draftPath(draftId), result.error);
    revalidateDraft(draftId);
    return undefined;
  },
  FORM_UNREADABLE,
);

export const makeDraftDeckAction = formRedirect(
  DraftForm,
  async ({ actor, capabilities }, { draftId }) => {
    const result = await capabilities.drafts.makeDraftDeck(actor, draftId);
    if (!result.ok) return backTo(draftPath(draftId), result.error);
    revalidateDeckList();
    return `/decks/${result.value}`;
  },
  FORM_UNREADABLE,
);

/** An admin hosting a lobby adds a bot, paying its entry fee (a testing tool). */
export const addBotAction = formRedirect(
  DraftForm,
  async ({ actor, capabilities }, { draftId }) => {
    const result = await capabilities.drafts.addBot(actor, draftId);
    if (!result.ok) return backTo(draftPath(draftId), result.error);
    revalidateDraft(draftId);
    return undefined;
  },
  FORM_UNREADABLE,
);

export const removeBotAction = formRedirect(
  z.object({ draftId: DraftIdField, botNumber: z.coerce.number() }),
  async ({ actor, capabilities }, { draftId, botNumber }) => {
    const result = await capabilities.drafts.removeBot(actor, { draftId, botNumber });
    if (!result.ok) return backTo(draftPath(draftId), result.error);
    revalidateDraft(draftId);
    return undefined;
  },
  FORM_UNREADABLE,
);
