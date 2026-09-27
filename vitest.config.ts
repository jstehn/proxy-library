import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        // Pure and in-memory tests: no database, milliseconds each.
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
          exclude: ["**/*.int.test.ts"],
        },
      },
      {
        // Real Postgres (the tcg_test database). See docs/architecture/testing.md.
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts", "worker/**/*.int.test.ts"],
          globalSetup: ["tests/setup/integration.ts"],
          env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" },
          fileParallelism: false,
        },
      },
    ],
  },
});
