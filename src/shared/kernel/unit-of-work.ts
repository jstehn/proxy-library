import type { Result } from "./result";

/**
 * Port for a transaction boundary. `run` hands `work` a bundle of transaction-bound
 * services; the transaction commits when `work` returns `ok` and rolls back when it
 * returns `err` or throws. See ADR 0005.
 *
 * Use cases declare the narrow bundle they need (`UnitOfWork<{ wallet: WalletOps }>`);
 * the composition root's full bundle satisfies it structurally.
 */
export interface UnitOfWork<Services> {
  run<T, E>(work: (services: Services) => Promise<Result<T, E>>): Promise<Result<T, E>>;
}
