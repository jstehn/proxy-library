import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { Pool, type PoolClient } from "pg";

export type QueryTimingEvent = Readonly<{
  durationMs: number;
  sql: string;
  isTransactionControl: boolean;
}>;

type QueryCallable = (...args: unknown[]) => unknown;
type ConnectCallable = (...args: unknown[]) => unknown;

function extractSql(queryArg: unknown): string {
  if (typeof queryArg === "string") return queryArg;
  if (typeof queryArg === "object" && queryArg !== null && "text" in queryArg) {
    const candidate = (queryArg as { text?: unknown }).text;
    return typeof candidate === "string" ? candidate : "";
  }
  return "";
}

function isTransactionControlSql(sqlText: string): boolean {
  return /^\s*(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(sqlText);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function instrumentPool(pool: Pool, onQuery: (event: QueryTimingEvent) => void): void {
  const wrappedClients = new WeakSet<object>();
  let inPoolQueryConnect = false;
  let suppressClientQuery = false;

  function wrapQuery<Target extends object>(
    target: Target,
    originalQuery: QueryCallable,
    shouldSkip: () => boolean,
    withInvokeScope?: <Result>(fn: () => Result) => Result,
  ): QueryCallable {
    return function instrumentedQuery(...args: unknown[]): unknown {
      if (shouldSkip()) {
        return originalQuery.apply(target, args);
      }

      const sqlText = extractSql(args[0]);
      const isTransactionControl = isTransactionControlSql(sqlText);
      const startMs = performance.now();
      let recorded = false;
      const record = () => {
        if (recorded) return;
        recorded = true;
        onQuery({
          durationMs: performance.now() - startMs,
          sql: sqlText,
          isTransactionControl,
        });
      };

      const lastIndex = args.length - 1;
      const maybeCallback = lastIndex >= 0 ? args[lastIndex] : undefined;
      const forwardedArgs = [...args];
      if (typeof maybeCallback === "function") {
        const callback = maybeCallback as (...callbackArgs: readonly unknown[]) => unknown;
        const runInContext = AsyncLocalStorage.snapshot();
        forwardedArgs[lastIndex] = (...callbackArgs: readonly unknown[]) =>
          runInContext(() => {
            record();
            return callback(...callbackArgs);
          });
      }

      let outcome: unknown;
      try {
        outcome = withInvokeScope
          ? withInvokeScope(() => originalQuery.apply(target, forwardedArgs))
          : originalQuery.apply(target, forwardedArgs);
      } catch (error) {
        record();
        throw error;
      }

      if (typeof maybeCallback !== "function" && isPromiseLike(outcome)) {
        return outcome.then(
          (queryResult) => {
            record();
            return queryResult;
          },
          (error: unknown) => {
            record();
            throw error;
          },
        );
      }

      return outcome;
    };
  }

  function instrumentClient(client: PoolClient): void {
    if (wrappedClients.has(client)) return;
    wrappedClients.add(client);
    const originalClientQuery = client.query.bind(client) as QueryCallable;
    client.query = wrapQuery(
      client,
      originalClientQuery,
      () => suppressClientQuery,
    ) as PoolClient["query"];
  }

  const originalPoolConnect = pool.connect.bind(pool) as ConnectCallable;
  pool.connect = ((...args: unknown[]): unknown => {
    const fromPoolQuery = inPoolQueryConnect;
    const callback =
      typeof args[0] === "function"
        ? (args[0] as (...callbackArgs: readonly unknown[]) => unknown)
        : undefined;

    if (callback !== undefined) {
      const runInContext = AsyncLocalStorage.snapshot();
      return originalPoolConnect((...callbackArgs: readonly unknown[]) => {
        const client = callbackArgs[1];
        if (typeof client === "object" && client !== null) {
          instrumentClient(client as PoolClient);
        }
        if (fromPoolQuery) {
          suppressClientQuery = true;
          try {
            return callback(...callbackArgs);
          } finally {
            suppressClientQuery = false;
          }
        }
        return runInContext(() => callback(...callbackArgs));
      });
    }

    const pending = originalPoolConnect(...args);
    if (isPromiseLike(pending)) {
      return pending.then((client) => {
        if (typeof client === "object" && client !== null) {
          instrumentClient(client as PoolClient);
        }
        return client;
      });
    }
    return pending;
  }) as Pool["connect"];

  const originalPoolQuery = pool.query.bind(pool) as QueryCallable;
  pool.query = wrapQuery(
    pool,
    originalPoolQuery,
    () => false,
    (invoke) => {
      inPoolQueryConnect = true;
      try {
        return invoke();
      } finally {
        inPoolQueryConnect = false;
      }
    },
  ) as Pool["query"];
}

/** Create a pooled Drizzle database. Called only by composition roots and test setup. */
export function createDatabase(
  databaseUrl: string,
  options?: { max?: number; onQuery?: (event: QueryTimingEvent) => void },
) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: options?.max ?? 20,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
  });
  pool.on("error", (error) => console.error("pg pool error", error));
  if (options?.onQuery) {
    instrumentPool(pool, options.onQuery);
  }
  let closing: Promise<void> | null = null;
  return {
    db: drizzle({ client: pool }),
    close: () => (closing ??= pool.end()),
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];

/**
 * Anything that can run queries: the database itself or an open transaction.
 * Repositories and query functions accept this, so they work inside or outside a
 * unit of work.
 */
export type DbExecutor = PgDatabase<NodePgQueryResultHKT>;
