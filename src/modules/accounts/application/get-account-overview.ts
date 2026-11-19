import { ok, type Result, type UserId } from "@/shared/kernel";

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
  refreshBalance(userId: UserId): Promise<number>;
  /** The allowance, or null when it is off, with the next payday. */
  allowance(): Promise<Readonly<{ amountCents: number; everyDays: number; next: Date }> | null>;
  collectionTotals(
    userId: UserId,
  ): Promise<Readonly<{ differentCards: number; copies: number; valueCents: number }>>;
  deckCount(userId: UserId): Promise<number>;
  wishCount(userId: UserId): Promise<number>;
}>;

/** Capability: the player's balance, allowance and totals. These readers belong to other modules, so the composition root passes them in as ports. */
export function makeGetAccountOverview(dependencies: GetAccountOverviewDependencies) {
  async function getAccountOverview(
    actor: Readonly<{ userId: UserId }>,
  ): Promise<Result<AccountOverview, never>> {
    const userId = actor.userId;
    const [balanceCents, allowance, collection, decks, wishes] = await Promise.all([
      dependencies.refreshBalance(userId),
      dependencies.allowance(),
      dependencies.collectionTotals(userId),
      dependencies.deckCount(userId),
      dependencies.wishCount(userId),
    ]);
    return ok({ balanceCents, allowance, collection, decks, wishes });
  }

  return getAccountOverview;
}
