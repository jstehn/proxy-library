import type { Actor } from "@/modules/accounts";
import { forgetPullsAndPurchases } from "@/modules/activity";
import { giveUpEverything } from "@/modules/collection";
import { deleteAllDecks } from "@/modules/decks";
import { discardAllItems } from "@/modules/inventory";
import { closeOpenTrades } from "@/modules/trades";
import { resetBalance } from "@/modules/wallet";
import { err, ok, type Cents, type Result, type UserId } from "@/shared/kernel";
import type { Forbidden, PlayerNotFound } from "../domain/errors";
import type { ResetDependencies } from "./ports";

export type ResetPlayerError = Forbidden | PlayerNotFound;

/** What a reset did, for the admin's confirmation message. */
export type ResetSummary = Readonly<{
  tradesClosed: number;
  balance: Cents;
  itemsRemoved: number;
  copiesRemoved: number;
  decksDeleted: number;
  eventsForgotten: number;
}>;

/**
 * Empties a player's library (design doc 12): cards, sealed items and decks go, open trades
 * close, and the balance goes back to the starting grant, as when the account was new. All or
 * nothing, in one transaction. The money and card histories keep a record of it. An admin may
 * reset anyone; a player may reset themselves ("Start over" on their Account page).
 */
export function makeResetPlayer(dependencies: ResetDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function resetPlayer(
    actor: Actor,
    userId: UserId,
  ): Promise<Result<ResetSummary, ResetPlayerError>> {
    const isSelf = actor.userId === userId;
    if (!actor.isAdmin && !isSelf) return err({ kind: "Forbidden" });

    return unitOfWork.run<ResetSummary, ResetPlayerError>(async (services) => {
      if (!(await services.playerDirectory.exists(userId))) return err({ kind: "PlayerNotFound" });
      const now = clock.now();
      const note = isSelf ? "Started over" : `Library reset by ${actor.username}`;

      // Locks are taken in the same order as the actions they could meet (a trade being
      // accepted locks the trade, then wallets; an opening locks the item, then cards), so a
      // reset waits for them instead of deadlocking.
      const tradesClosed = await closeOpenTrades(services, userId, now);
      const balance = await resetBalance(services, { userId, resetBy: actor.userId, note, now });
      const itemsRemoved = await discardAllItems(services, userId);
      const copiesRemoved = await giveUpEverything(services, userId, {
        source: "reset",
        ref: `reset:${actor.userId}`,
        at: now,
      });
      const decksDeleted = await deleteAllDecks(services, userId);
      const eventsForgotten = await forgetPullsAndPurchases(services, userId);

      return ok({
        tradesClosed,
        balance,
        itemsRemoved,
        copiesRemoved,
        decksDeleted,
        eventsForgotten,
      });
    });
  }

  return resetPlayer;
}
