import { receive } from "@/modules/wallet";
import type { UserId } from "@/shared/kernel";
import { leaveDraft } from "../domain/draft";
import type { DraftsServices } from "./ports";
import { settle } from "./settle";

/**
 * Takes a player out of every lobby they're in, with refunds, inside the caller's transaction (a
 * reset, design doc 12). A lobby they host closes, refunding everyone. A draft that has started
 * keeps their seat: the timer picks for them, so the others can finish.
 * Returns how many lobbies they left.
 */
export async function removeFromLobbies(
  services: DraftsServices,
  userId: UserId,
  now: Date,
): Promise<number> {
  const lobbies = await services.drafts.lobbiesWith(userId);
  for (const draftId of lobbies) {
    const draft = await services.drafts.lock(draftId);
    if (draft === null) continue;
    const left = leaveDraft(draft, userId);
    if (!left.ok) continue; // started meanwhile: nothing to undo
    for (const refund of left.value.refunds) {
      await receive(services, {
        userId: refund.userId,
        amount: refund.amount,
        kind: "draft_refund",
        note: "Draft lobby closed",
        ref: `draft:${draft.id}`,
        now,
      });
    }
    await settle(services, draft, left.value.draft, now);
  }
  return lobbies.length;
}
