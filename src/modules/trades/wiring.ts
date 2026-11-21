import { pick } from "@/shared/kernel";
import type { Trades } from "./application/trades";

// The trades module's capabilities (ADR 0026): only what callers use.

export function wireTradeCapabilities({ trades }: Readonly<{ trades: Trades }>) {
  return {
    trades: pick(
      trades,
      "proposeTrade",
      "counterTrade",
      "acceptTrade",
      "declineTrade",
      "cancelTrade",
    ),
  };
}
