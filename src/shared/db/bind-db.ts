import type { UserId } from "@/shared/kernel";
import type { DbExecutor } from "./client";

// `bindDb` turns a module's query functions into `reads` (design doc 67, sections 3 and 4): each
// query keeps its own signature `(db, actor, ...)`, and the bound copy drops the first argument.
// The mapped type below is "homomorphic" (it maps over `keyof Queries`), so in an editor "Go to
// definition" on `reads.activity.feed` lands on the SQL function itself.

/** A query function with its database filled in. Anything that isn't a query becomes `never`. */
type Bound<Query> = Query extends (db: DbExecutor, ...rest: infer Rest) => infer Answer
  ? (...rest: Rest) => Answer
  : never;

/** A module's queries without their first argument, the database. */
export type BoundQueries<Queries> = { [Name in keyof Queries]: Bound<Queries[Name]> };

/**
 * Turns every function whose first argument after the database is one of `Refused` into `never`,
 * so handing it to `bindDb` fails to compile.
 */
type Refusing<Queries, Refused> = {
  [Name in keyof Queries]: Queries[Name] extends (
    db: DbExecutor,
    first: infer First,
    ...rest: never[]
  ) => unknown
    ? [NonNullable<First>] extends [Refused]
      ? never
      : Queries[Name]
    : Queries[Name];
};

/** What a visitor's read must never ask for: a player, or an id that stands for one. */
type APlayer = UserId | { readonly userId: UserId };

function bindAll<Queries extends object>(db: DbExecutor, queries: Queries): BoundQueries<Queries> {
  const bound: Record<string, unknown> = {};
  for (const [name, query] of Object.entries(queries)) {
    bound[name] = (...rest: unknown[]) => (query as (...all: unknown[]) => unknown)(db, ...rest);
  }
  return bound as BoundQueries<Queries>;
}

/**
 * Fills in the database of every query in a module's `queries/index.ts`. A query that takes a
 * plain `UserId` right after the database is refused: a player read takes the `Actor` instead.
 */
export function bindDb<Queries extends object>(
  db: DbExecutor,
  queries: Queries & Refusing<Queries, UserId>,
): BoundQueries<Queries> {
  return bindAll(db, queries);
}

/**
 * The same for the reads a visitor may call (`PublicReads`): their credential is a token or
 * nothing. A query that takes a `UserId` or an `Actor` is refused, so a visitor's page can't
 * reach a player's data by passing an id.
 */
export function bindPublicDb<Queries extends object>(
  db: DbExecutor,
  queries: Queries & Refusing<Queries, APlayer>,
): BoundQueries<Queries> {
  return bindAll(db, queries);
}
