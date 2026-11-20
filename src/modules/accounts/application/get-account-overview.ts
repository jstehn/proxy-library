import { ok, type Result } from "@/shared/kernel";
import type { Actor } from "../domain/player";

/** What a player has, in whole numbers (money in integer cents). */
export type AccountOverview = Readonly<{
  balanceCents: number;
  /** Null when allowances are switched off. */
  allowance: Readonly<{ amountCents: number; everyDays: number; next: Date }> | null;
  collection: Readonly<{ differentCards: number; copies: number; valueCents: number }>;
  decks: number;
  wishes: number;
}>;

export type GetAccountOverviewDependencies = Readonly<{
  /** Brings the wallet up to date (a due allowance is paid) and returns the balance. */
  refreshBalance(actor: Actor): Promise<number>;
  /** The allowance, or null when it is off, with the next payday. */
  allowance(): Promise<Readonly<{ amountCents: number; everyDays: number; next: Date }> | null>;
  collectionTotals(
    actor: Actor,
  ): Promise<Readonly<{ differentCards: number; copies: number; valueCents: number }>>;
  deckCount(actor: Actor): Promise<number>;
  wishCount(actor: Actor): Promise<number>;
}>;

/** Capability: the player's balance, allowance and totals. These readers belong to other modules, so the composition root passes them in as ports. */
export function makeGetAccountOverview(dependencies: GetAccountOverviewDependencies) {
  async function getAccountOverview(actor: Actor): Promise<Result<AccountOverview, never>> {
    const [balanceCents, allowance, collection, decks, wishes] = await Promise.all([
      dependencies.refreshBalance(actor),
      dependencies.allowance(),
      dependencies.collectionTotals(actor),
      dependencies.deckCount(actor),
      dependencies.wishCount(actor),
    ]);
    return ok({ balanceCents, allowance, collection, decks, wishes });
  }

  return getAccountOverview;
}
