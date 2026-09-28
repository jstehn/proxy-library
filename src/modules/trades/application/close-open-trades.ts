import type { UserId } from "@/shared/kernel";
import { decide } from "../domain/trade";
import type { TradesServices } from "./ports";

/**
 * Ends every trade still waiting on a player, inside the caller's transaction (an admin
 * resetting a player): ones they proposed are cancelled, ones they received are declined, as if
 * they had pressed the button themselves. Returns how many trades were closed.
 */
export async function closeOpenTrades(
  services: Pick<TradesServices, "trades">,
  userId: UserId,
  now: Date,
): Promise<number> {
  let closed = 0;
  for (const tradeId of await services.trades.openInvolving(userId)) {
    const trade = await services.trades.lock(tradeId);
    const event = trade?.proposerId === userId ? "cancel" : "decline";
    const decided = decide(trade, userId, event, now);
    if (!decided.ok) continue; // decided by someone else while we waited for the lock
    await services.trades.decide(decided.value);
    closed++;
  }
  return closed;
}
