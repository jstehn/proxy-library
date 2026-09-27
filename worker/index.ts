// Worker entry point: `pnpm worker <command>`.
import { productProblems } from "@/modules/inventory";
import { loadProductCheck } from "@/modules/inventory/infrastructure";
import { runMigrations } from "@/shared/db";
import { realSleep } from "@/shared/runtime";
import { createWorkerContainer, type WorkerContainer } from "./container";

const commands: Record<string, (container: WorkerContainer) => Promise<void>> = {
  async health(container) {
    const result = await container.checkHealth();
    if (!result.ok) throw new Error(`unhealthy: ${result.error.message}`);
    console.log("healthy", result.value);
  },

  async migrate(container) {
    const applied = await runMigrations(container.db);
    console.log(applied ? "migrations applied" : "no migrations to apply yet");
  },

  /** `pnpm worker sync [prices|full]`: run a catalog sync now and print what it did. */
  async sync(container) {
    const kind = process.argv[3] === "full" ? "full" : "prices";
    const { catalog } = container;
    await catalog.recoverInterruptedRuns();
    // Queue it like the admin button does (unless something is already waiting), then run it.
    await catalog.queueSync(kind);
    console.log(`running ${kind} sync…`);
    const result = await catalog.runNextQueuedSync();
    console.log(JSON.stringify(result, null, 2));
    if (result?.status === "failed") process.exitCode = 1;
  },

  /**
   * `pnpm worker check-packs [packs]`: open that many packs (default 1,000) of every booster
   * recipe in the catalog and report anything that breaks the recipe's rules (design doc 05).
   */
  async "check-packs"(container) {
    const packsPerBooster = Number(process.argv[3] ?? 1_000);
    if (!Number.isInteger(packsPerBooster) || packsPerBooster < 1) {
      throw new Error(`packs must be a positive whole number, got ${process.argv[3]}`);
    }
    console.log(`opening ${packsPerBooster} packs of every booster recipe…`);
    const checks = await container.packs.checkBoosters(packsPerBooster);
    const withProblems = checks.filter((check) => check.problems.length > 0);
    for (const check of withProblems) {
      console.log(`\n${check.setCode} ${check.boosterType}:`);
      for (const { problem, packs } of check.problems) {
        console.log(`  ${problem} (in ${packs} of ${check.packsOpened} packs)`);
      }
    }
    const opened = checks.reduce((total, check) => total + check.packsOpened, 0);
    console.log(
      `\n${checks.length} recipes, ${opened} packs opened, ${withProblems.length} recipe(s) with problems`,
    );
    if (withProblems.length > 0) process.exitCode = 1;
  },

  /**
   * `pnpm worker check-products`: every product in an enabled set must open into something, and
   * everything it names must exist (design doc 11, section 5; the empty-precon bug).
   */
  async "check-products"(container) {
    const { toCheck, knowledge } = await loadProductCheck(container.db);
    let bad = 0;
    for (const product of toCheck) {
      const problems = productProblems(product.contents, knowledge);
      if (problems.length === 0) continue;
      bad += 1;
      console.log(`\n${product.setCode} ${product.name}:`);
      for (const problem of problems.slice(0, 5)) console.log(`  ${problem}`);
    }
    console.log(`\n${toCheck.length} products checked, ${bad} with problems`);
    if (bad > 0) process.exitCode = 1;
  },

  /** `pnpm worker schedule`: keep running; do the nightly sync and anything admins queue. */
  async schedule(container) {
    const { catalog } = container;
    const recovered = await catalog.recoverInterruptedRuns();
    if (recovered > 0) console.log(`marked ${recovered} interrupted run(s) as failed`);
    console.log("worker scheduling: checking for sync work every 30 seconds (Ctrl+C to stop)");

    let stopping = false;
    process.once("SIGINT", () => {
      stopping = true;
      console.log("stopping after the current step…");
    });

    while (!stopping) {
      if (await catalog.queueNightlyIfDue()) console.log("queued the nightly prices sync");
      const result = await catalog.runNextQueuedSync();
      if (result !== null) {
        console.log(`sync run ${result.run.id} (${result.run.kind}): ${result.status}`);
      }
      await sleepUnlessStopping(30_000, () => stopping);
    }
  },
};

/** Waits up to `milliseconds`, checking every second whether to stop early. */
async function sleepUnlessStopping(milliseconds: number, isStopping: () => boolean) {
  for (let waited = 0; waited < milliseconds && !isStopping(); waited += 1000) {
    await realSleep(1000);
  }
}

async function main(name: string | undefined) {
  const command = name === undefined ? undefined : commands[name];
  if (command === undefined) {
    console.error(`usage: pnpm worker <${Object.keys(commands).join("|")}>`);
    process.exitCode = 1;
    return;
  }
  const container = createWorkerContainer();
  try {
    await command(container);
  } finally {
    await container.close();
  }
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
