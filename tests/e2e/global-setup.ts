// Runs once before the browser tests: bring the e2e database up to date and empty it.
import { sql } from "drizzle-orm";
import { loadConfig } from "@/shared/config";
import { createDatabase, runMigrations } from "@/shared/db";

export default async function globalSetup() {
  const { databaseUrl } = loadConfig({
    ...process.env,
    DATABASE_URL: process.env.E2E_DATABASE_URL,
  });
  if (!databaseUrl.includes("_e2e")) {
    throw new Error(`Refusing to reset a non-e2e database: ${databaseUrl}`);
  }
  const { db, close } = createDatabase(databaseUrl);
  try {
    await runMigrations(db);
    await db.execute(sql`truncate invites, players, auth_users cascade`);
  } finally {
    await close();
  }
}
