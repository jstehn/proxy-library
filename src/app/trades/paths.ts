import { revalidatePath } from "next/cache";
import { revalidateHeader } from "../paths";

// The trade area's paths, and what to refresh after a change.

export const TRADES_PATH = "/trades";
export const NEW_TRADE_PATH = "/trades/new";

export function tradePath(tradeId: number, error?: string): string {
  const path = `${TRADES_PATH}/${tradeId}`;
  return error === undefined ? path : `${path}?error=${encodeURIComponent(error)}`;
}

/** The list, one trade's page when given, and the header (the badge and the balance). */
export function revalidateTrades(tradeId?: number): void {
  revalidatePath(TRADES_PATH);
  if (tradeId !== undefined) revalidatePath(tradePath(tradeId));
  revalidateHeader();
}
