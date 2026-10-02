import type { LedgerKind } from "@/modules/wallet";
import { assertNever } from "@/shared/kernel";

/** How each kind of ledger entry is described to players. */
export function ledgerKindLabel(kind: LedgerKind): string {
  switch (kind) {
    case "starting_grant":
      return "Starting grant";
    case "allowance":
      return "Allowance";
    case "grant":
      return "Given by an admin";
    case "correction":
      return "Correction by an admin";
    case "self_fund":
      return "Added by you";
    case "purchase_sealed":
      return "Bought sealed product";
    case "purchase_single":
      return "Bought a single";
    case "sellback":
      return "Sold to the store";
    case "trade_in":
      return "Received in a trade";
    case "trade_out":
      return "Given in a trade";
    case "draft_entry":
      return "Draft entry fee";
    case "draft_refund":
      return "Draft entry fee refunded";
    default:
      return assertNever(kind);
  }
}
