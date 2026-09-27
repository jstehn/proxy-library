import { sql } from "drizzle-orm";
import type { DbExecutor } from "./client";

/** Database-level facts, used by the health check. */
export function makeSystemService(db: DbExecutor) {
  return {
    async databaseTime(): Promise<Date> {
      const result = await db.execute<{ now: Date }>(sql`select now() as now`);
      return new Date(result.rows[0].now);
    },
  };
}

export type SystemService = ReturnType<typeof makeSystemService>;
