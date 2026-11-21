import { count } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { players } from "../infrastructure/schema";

// The accounts reads a visitor may call (design doc 67, kind V): `src/server/reads.ts` binds them
// with `bindPublicDb`, so none of them can take a player.

/** Whether anyone has registered yet (the register page hides the invite field if not). */
export async function hasAnyPlayers(db: DbExecutor): Promise<boolean> {
  const [row] = await db.select({ total: count() }).from(players);
  return row.total > 0;
}
