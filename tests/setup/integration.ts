// Vitest global setup for the "integration" project: runs once, in the main process,
// before all integration tests. (The project's `env` override only applies inside test
// workers, so we point the config at TEST_DATABASE_URL explicitly here.)
import { loadConfig } from "@/shared/config";
import { createDatabase, runMigrations } from "@/shared/db";

export default async function setup() {
  const { databaseUrl } = loadConfig({
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
  });
  if (!databaseUrl.includes("_test")) {
    throw new Error(
      `Refusing to run integration tests against a non-test database: ${databaseUrl}`,
    );
  }
  const { db, close } = createDatabase(databaseUrl);
  try {
    await runMigrations(db);
  } catch (error) {
    throw new Error(
      `Test database unavailable. Is Postgres running? (pnpm db:start)\n${String(error)}`,
    );
  } finally {
    await close();
  }
}
