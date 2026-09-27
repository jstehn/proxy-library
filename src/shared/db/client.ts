import { drizzle, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { Pool } from "pg";

/** Create a pooled Drizzle database. Called only by composition roots and test setup. */
export function createDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return {
    db: drizzle({ client: pool }),
    close: () => pool.end(),
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];

/**
 * Anything that can run queries: the database itself or an open transaction.
 * Repositories and query functions accept this, so they work inside or outside a
 * unit of work.
 */
export type DbExecutor = PgDatabase<NodePgQueryResultHKT>;
