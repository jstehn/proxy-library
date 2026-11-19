import type { DbExecutor } from "./client";

/** A query function without its first argument, the database. */
export type WithoutDb<Query> = Query extends (db: DbExecutor, ...rest: infer Rest) => infer Answer
  ? (...rest: Rest) => Answer
  : never;

/**
 * A query function with its database filled in, for a module's `wiring.ts`: the capability takes
 * what the question needs and the database stays inside the composition (ADR 0026).
 */
export function withDb<Query extends (db: DbExecutor, ...rest: never[]) => unknown>(
  db: DbExecutor,
  query: Query,
): WithoutDb<Query> {
  return ((...rest: never[]) => query(db, ...rest)) as WithoutDb<Query>;
}
