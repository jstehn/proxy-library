"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type DeckPlan } from "@/modules/decks";

import { builderAction, DeckIdInput, NOT_YOURS, fail } from "../action-helpers";

// The builder's plan and primer panel (design doc 61).

/** The deck's plan (structured profile) and primer, for the primer panel (design doc 61). */
export type DeckPlanWithPrimer = Readonly<{ profile: DeckPlan; primer: string }>;

const deckPlan = builderAction<typeof DeckIdInput, DeckPlanWithPrimer | null>(
  DeckIdInput,
  null,
  async ({ actor, capabilities }, deckId) => {
    const overview = await capabilities.deckOverview({
      userId: actor.userId,
      deckId,
      parts: { profile: true },
    });
    const stored = overview.ok ? overview.value.profile : null;
    if (stored === null || stored === undefined) return null;
    return { profile: stored.profile, primer: stored.primer ?? "" };
  },
);

/** Loads the deck's plan and primer, or null if it isn't the player's. */
export async function deckPlanAction(deckId: number): Promise<DeckPlanWithPrimer | null> {
  return deckPlan(deckId);
}

const NamedCardInput = z.object({
  cardName: z.string().trim().min(1).max(141),
  reason: z.string().trim().max(200),
});

const DeckPlanInput = z.object({
  deckId: DeckIdInput,
  plan: z.string().trim().max(600).nullable(),
  winCons: z.array(z.string().trim().min(1).max(200)).max(20),
  keyCards: z.array(NamedCardInput).max(40),
  avoid: z.array(NamedCardInput).max(40),
  declaredCombos: z.array(z.string().trim().min(1).max(300)).max(20),
  mulligan: z.string().trim().max(1000).nullable(),
  pilotNotes: z.string().trim().max(2000).nullable(),
  primer: z.string().max(20_000),
});

export type DeckPlanResult =
  { ok: true; plan: DeckPlanWithPrimer } | { ok: false; message: string };

/** Saves the deck's plan fields and its primer (design doc 61). */
export const saveDeckPlanAction = builderAction<typeof DeckPlanInput, DeckPlanResult>(
  DeckPlanInput,
  fail("Something there is too long or empty; check the fields."),
  async ({ actor, capabilities }, input) => {
    const { deckPlanEdits } = capabilities;
    const { deckId, primer, ...fields } = input;
    const updated = await deckPlanEdits.setProfile(actor, {
      deckId,
      patch: {
        ...fields,
        plan: fields.plan === "" ? null : fields.plan,
        mulligan: fields.mulligan === "" ? null : fields.mulligan,
        pilotNotes: fields.pilotNotes === "" ? null : fields.pilotNotes,
      },
    });
    if (!updated.ok) return fail(NOT_YOURS);
    const savedPrimer = await deckPlanEdits.setPrimer(actor, { deckId, content: primer });
    revalidatePath(`/decks/${deckId}`);
    return {
      ok: true,
      plan: {
        profile: updated.value.profile,
        primer: savedPrimer.ok ? savedPrimer.value.primer : primer.trim(),
      },
    };
  },
);
