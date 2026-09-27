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
    default:
      return assertNever(kind);
  }
}
