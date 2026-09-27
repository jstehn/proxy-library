import type { Err, Result, UnitOfWork } from "@/shared/kernel";
import type { Database, DbExecutor } from "./client";

/**
 * Postgres implementation of the UnitOfWork port (ADR 0005).
 *
 * `servicesFor` is called at the start of each transaction. It receives the open
 * transaction and returns the services that `work` will use, all bound to that
 * transaction, so everything they write commits or rolls back together.
 */
export function makeDrizzleUnitOfWork<Services>(
  db: Database,
  servicesFor: (transaction: DbExecutor) => Services,
): UnitOfWork<Services> {
  async function run<T, E>(
    work: (services: Services) => Promise<Result<T, E>>,
  ): Promise<Result<T, E>> {
    // Drizzle rolls a transaction back only when its callback throws. Our work reports
    // failure by returning `err` instead, so for an `err` we throw this private signal,
    // catch it below, and hand the original `err` back to the caller.
    const rollbackSignal = new Error("unit of work rolled back");
    let failedResult: Err<E> | undefined;

    try {
      return await db.transaction(async (transaction) => {
        const result = await work(servicesFor(transaction));
        if (!result.ok) {
          failedResult = result;
          throw rollbackSignal; // → ROLLBACK
        }
        return result; // → COMMIT
      });
    } catch (error) {
      if (error === rollbackSignal && failedResult !== undefined) return failedResult;
      throw error; // a real error: let it propagate
    }
  }

  return { run };
}
