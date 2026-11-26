import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { players } from "../infrastructure/schema";

// The accounts reads a visitor may call (design doc 67, kind V): `src/server/composition/reads.ts` binds them
// with `bindPublicDb`, so none of them can take a player.

/** Whether anyone has registered yet (the register page hides the invite field if not). */
export async function hasAnyPlayers(db: DbExecutor): Promise<boolean> {
  const [row] = await db
    .select({ present: sql<number>`1` })
    .from(players)
    .limit(1);
  return row !== undefined;
}
