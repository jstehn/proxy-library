// Worker entry point: `pnpm worker <command>`.
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
