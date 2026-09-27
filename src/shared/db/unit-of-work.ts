import type { Err, Result, UnitOfWork } from "@/shared/kernel";
import type { Database, DbExecutor } from "./client";

/**
 * Postgres implementation of the UnitOfWork port (ADR 0005).
 *
 * `bindServices` builds the transaction-bound service bundle: the composition root
 * passes a function that constructs every module's services around `tx`.
 */
export function makeDrizzleUnitOfWork<Services>(
  db: Database,
  bindServices: (tx: DbExecutor) => Services,
): UnitOfWork<Services> {
  return {
    async run<T, E>(work: (services: Services) => Promise<Result<T, E>>): Promise<Result<T, E>> {
      // Drizzle rolls back when the transaction callback throws. For an `err` result we
      // throw a private signal, then hand the original Result back to the caller.
      const rollback = new Error("unit of work rolled back");
      let rolledBackWith: Err<E> | undefined;
      try {
        return await db.transaction(async (tx) => {
          const result = await work(bindServices(tx));
          if (!result.ok) {
            rolledBackWith = result;
            throw rollback;
          }
          return result;
        });
      } catch (error) {
        if (error === rollback && rolledBackWith) return rolledBackWith;
        throw error;
      }
    },
  };
}
