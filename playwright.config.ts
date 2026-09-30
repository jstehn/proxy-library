import { defineConfig, devices } from "@playwright/test";

// End-to-end tests: a real browser driving the real app against its own database (tcg_e2e).
// See docs/architecture/testing.md.
const PORT = 3100;
const APP_URL = `http://localhost:${PORT}`;
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "";
// Their own image folder: the setup stores placeholder product photos there, which must never
// replace the real ones in your development cache.
export const E2E_IMAGE_CACHE_DIR = `${process.cwd()}/.dev/e2e-images`;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false, // the journeys share one database
  workers: 1,
  use: { baseURL: APP_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `${APP_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      APP_URL,
      NEXT_DIST_DIR: ".next-e2e",
      IMAGE_CACHE_DIR: E2E_IMAGE_CACHE_DIR,
    },
  },
});
