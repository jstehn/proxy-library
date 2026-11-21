import { runMigrations } from "@/shared/db";
import { optionalLimit, type Command } from "./command";

export const health: Command = async (container) => {
  const result = await container.checkHealth();
  if (!result.ok) throw new Error(`unhealthy: ${result.error.message}`);
  console.log("healthy", result.value);
};

export const migrate: Command = async (container) => {
  const applied = await runMigrations(container.db);
  console.log(applied ? "migrations applied" : "no migrations to apply yet");
};

/**
 * `pnpm worker sync [prices|full]`: run a catalog sync now and print what it did.
 * `pnpm worker sync features` only works out the card features that are missing or out of date.
 */
export const sync: Command = async (container) => {
  if (process.argv[3] === "features") {
    const computed = await container.catalog.featuresPass();
    console.log(`${computed} oracle cards' features worked out`);
    return;
  }
  const kind = process.argv[3] === "full" ? "full" : "prices";
  const { catalog } = container;
  await catalog.recoverInterruptedRuns();
  // Queue it like the admin button does (unless something is already waiting), then run it.
  await catalog.queueSync(kind);
  console.log(`running ${kind} sync…`);
  const result = await catalog.runNextQueuedSync();
  console.log(JSON.stringify(result, null, 2));
  if (result?.status === "failed") process.exitCode = 1;
};

/**
 * `pnpm worker value-products`: value every sealed product's contents from today's prices now,
 * for the resale floor (design doc 27). The schedule does this after each sync by itself.
 */
export const valueProducts: Command = async (container) => {
  const report = await container.store.valueProducts();
  console.log(report === null ? "no prices yet: nothing to value" : JSON.stringify(report));
};

/**
 * `pnpm worker embed-cards [limit]`: compute and store frozen text embeddings for oracle cards
 * missing or with an outdated `(model, textVersion)` in `card_embeddings` (design doc 53).
 */
export const embedCards: Command = async (container) => {
  console.log(JSON.stringify(await container.catalog.embedCards({ limit: optionalLimit() })));
};

/**
 * `pnpm worker sync-edhrec [limit]`: fetch EDHREC community data for missing/stale commanders
 * (design doc 45).
 */
export const syncEdhrec: Command = async (container) => {
  console.log(JSON.stringify(await container.catalog.syncEdhrec({ limit: optionalLimit() })));
};

/**
 * `pnpm worker sync-rules [--force]`: fetch, parse, and embed Wizards' official
 * Comprehensive Rules into `comprehensive_rules` (design doc 60).
 */
export const syncRules: Command = async (container) => {
  const force = process.argv.includes("--force");
  console.log(JSON.stringify(await container.catalog.syncComprehensiveRules({ force })));
};
