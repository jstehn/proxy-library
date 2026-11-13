// Worker entry point: `pnpm worker <command>`.
import { invalidCommanders, pairProblem, preconCommanders } from "@/modules/decks";
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
   * `pnpm worker value-products`: value every sealed product's contents from today's prices now,
   * for the resale floor (design doc 27). The schedule does this after each sync by itself.
   */
  async "value-products"(container) {
    const report = await container.store.valueProducts();
    console.log(report === null ? "no prices yet: nothing to value" : JSON.stringify(report));
  },

  /**
   * `pnpm worker tag-cards`: work out the role tags and themes of every printing whose stored ones
   * are missing or out of date (design doc 20). Every sync does this too; this runs it alone.
   */
  async "tag-cards"(container) {
    const tagged = await container.catalog.tagPass();
    console.log(`${tagged} printings tagged`);
  },

  /**
   * `pnpm worker embed-cards [limit]`: compute and store frozen text embeddings for oracle cards
   * missing or with an outdated `(model, textVersion)` in `card_embeddings` (design doc 53).
   */
  async "embed-cards"(container) {
    const rawLimit = process.argv[3];
    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new Error(`limit must be a positive whole number, got ${rawLimit}`);
    }
    const summary = await container.catalog.embedCards({ limit });
    console.log(JSON.stringify(summary));
  },

  /**
   * `pnpm worker sync-edhrec [limit]`: fetch EDHREC community data for missing/stale commanders
   * (design doc 45).
   */
  async "sync-edhrec"(container) {
    const rawLimit = process.argv[3];
    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new Error(`limit must be a positive whole number, got ${rawLimit}`);
    }
    const summary = await container.catalog.syncEdhrec({ limit });
    console.log(JSON.stringify(summary));
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

  /**
   * `pnpm worker check-commanders`: every precon's commanders must be allowed to lead a deck. A
   * precon always has a valid commander, so any failure is a gap in our rule (Hearthhull, the
   * Worldseed found the 2025 Spacecraft rule).
   */
  async "check-commanders"(container) {
    const decks = await preconCommanders(container.db);
    let bad = 0;
    for (const deck of decks) {
      const invalid = invalidCommanders(deck.commanders);
      // Two commanders must also pair (design doc 40).
      const pairing = pairProblem(deck.commanders);
      if (invalid.length === 0 && pairing === null) continue;
      bad += 1;
      if (invalid.length > 0) {
        console.log(`${deck.setCode} ${deck.deckName}: rejected ${invalid.join(", ")}`);
      }
      if (pairing?.kind === "CommandersCantPair") {
        console.log(`${deck.setCode} ${deck.deckName}: can't pair ${pairing.names.join(" + ")}`);
      }
    }
    console.log(`\n${decks.length} precon decks checked, ${bad} with a rejected commander`);
    if (bad > 0) process.exitCode = 1;
  },

  /**
   * `pnpm worker schedule`: keep running; do the nightly sync and anything admins queue, and run
   * draft pick timers (design doc 17). The two loops run side by side: a sync can take minutes,
   * and a pick timer can't wait that long.
   */
  async schedule(container) {
    const { catalog, drafts, store } = container;
    const recovered = await catalog.recoverInterruptedRuns();
    if (recovered > 0) console.log(`marked ${recovered} interrupted run(s) as failed`);
    console.log(
      "worker scheduling: sync work every 30 seconds, draft timers every 5 (Ctrl+C to stop)",
    );

    let stopping = false;
    // Ctrl+C in a terminal sends SIGINT; `docker compose stop` sends SIGTERM.
    const stop = () => {
      stopping = true;
      console.log("stopping after the current step…");
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    async function syncLoop() {
      while (!stopping) {
        if (await catalog.queueNightlyIfDue()) console.log("queued the nightly prices sync");
        const result = await catalog.runNextQueuedSync();
        if (result !== null) {
          console.log(`sync run ${result.run.id} (${result.run.kind}): ${result.status}`);
        }
        // New prices (or a first start): value sealed products for the resale floor (design
        // doc 27). Kind-priced products aren't for sale until this has run once.
        try {
          const valued = await store.valueProductsIfStale();
          if (valued !== null) {
            console.log(
              `valued ${valued.products} products from ${valued.priceDay}'s prices (${valued.partial} partial)`,
            );
          }
        } catch (error) {
          console.error("valuing products failed:", error);
        }
        await sleepUnlessStopping(30_000, () => stopping);
      }
    }

    async function draftTimerLoop() {
      while (!stopping) {
        try {
          const report = await drafts.runTimers();
          if (report.autoPicks > 0 || report.extensions > 0) {
            console.log(
              `draft timers: ${report.autoPicks} auto-pick(s), ${report.extensions} extension(s)`,
            );
          }
        } catch (error) {
          // One bad draft mustn't stop every other table's timer.
          console.error("draft timers failed:", error);
        }
        await sleepUnlessStopping(5_000, () => stopping);
      }
    }

    // Like Python's asyncio.gather: both loops run until both have stopped.
    await Promise.all([syncLoop(), draftTimerLoop()]);
  },

  /** `pnpm worker draft-timers`: run the draft pick timers once and print what they did. */
  async "draft-timers"(container) {
    console.log(JSON.stringify(await container.drafts.runTimers()));
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
