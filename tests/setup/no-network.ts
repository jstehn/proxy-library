// Loaded by the unit and integration test projects (vitest.config.ts). Automated tests never call
// outside services (docs/architecture/testing.md): a gateway under test gets a fake `fetchFn`, and
// recorded responses live in tests/fixtures. This makes the global `fetch` throw, so a test that
// would reach the network fails at once instead of being slow, flaky or rate-limited.
// Tests that really call MTGJSON, Scryfall, Reddit or YouTube are `*.remote.test.ts` files, run
// only by `pnpm test:remote`, by hand, when that code is being worked on.

async function refuseNetwork(input: unknown): Promise<never> {
  const target = input instanceof Request ? input.url : String(input);
  throw new Error(
    `A test tried to call ${target}. Tests stay offline: pass a fake fetchFn or use a recorded ` +
      "fixture, or move the test to a *.remote.test.ts file (pnpm test:remote).",
  );
}

globalThis.fetch = refuseNetwork as typeof fetch;
