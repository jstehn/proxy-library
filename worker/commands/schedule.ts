import { realSleep } from "@/shared/runtime";
import type { WorkerContainer } from "../container";
import type { Command } from "./command";

/** Waits up to `milliseconds`, checking every second whether to stop early. */
async function sleepUnlessStopping(milliseconds: number, isStopping: () => boolean) {
  for (let waited = 0; waited < milliseconds && !isStopping(); waited += 1000) {
    await realSleep(1000);
  }
}

/** Queues the nightly sync when due, runs the next queued one, and values products on new prices. */
async function syncLoop(container: WorkerContainer, isStopping: () => boolean) {
  const { catalog, store } = container;
  while (!isStopping()) {
    if (await catalog.queueNightlyIfDue()) console.log("queued the nightly prices sync");
    const result = await catalog.runNextQueuedSync();
    if (result !== null) {
      console.log(`sync run ${result.run.id} (${result.run.kind}): ${result.status}`);
      try {
        const cr = await catalog.syncComprehensiveRules();
        if (!cr.skipped) {
          console.log(`comprehensive rules ${cr.version}: ${cr.ruleCount} rules synced`);
        }
      } catch (error) {
        console.error("comprehensive rules sync failed:", error);
      }
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
    await sleepUnlessStopping(30_000, isStopping);
  }
}

async function draftTimerLoop(container: WorkerContainer, isStopping: () => boolean) {
  while (!isStopping()) {
    try {
      const report = await container.drafts.runTimers();
      if (report.autoPicks > 0 || report.extensions > 0) {
        console.log(
          `draft timers: ${report.autoPicks} auto-pick(s), ${report.extensions} extension(s)`,
        );
      }
    } catch (error) {
      // One bad draft mustn't stop every other table's timer.
      console.error("draft timers failed:", error);
    }
    await sleepUnlessStopping(5_000, isStopping);
  }
}

/**
 * `pnpm worker schedule`: keep running; do the nightly sync and anything admins queue, and run
 * draft pick timers (design doc 17). The two loops run side by side: a sync can take minutes,
 * and a pick timer can't wait that long.
 */
export const schedule: Command = async (container) => {
  const recovered = await container.catalog.recoverInterruptedRuns();
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

  // Like Python's asyncio.gather: both loops run until both have stopped.
  const isStopping = () => stopping;
  await Promise.all([syncLoop(container, isStopping), draftTimerLoop(container, isStopping)]);
};

/** `pnpm worker draft-timers`: run the draft pick timers once and print what they did. */
export const draftTimers: Command = async (container) => {
  console.log(JSON.stringify(await container.drafts.runTimers()));
};
