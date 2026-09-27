import { existsSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client";

export const MIGRATIONS_FOLDER = "drizzle";

/**
 * Apply pending drizzle-kit migrations. Returns false when no migrations exist yet
 * (before the first module defines tables).
 */
export async function runMigrations(db: Database, folder = MIGRATIONS_FOLDER): Promise<boolean> {
  if (!existsSync(join(folder, "meta", "_journal.json"))) return false;
  await migrate(db, { migrationsFolder: folder });
  return true;
}
