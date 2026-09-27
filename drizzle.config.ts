import { defineConfig } from "drizzle-kit";
import { loadConfig } from "./src/shared/config";

// Each module owns its tables in src/modules/<module>/infrastructure/schema.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/modules/*/infrastructure/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: loadConfig().databaseUrl },
});
