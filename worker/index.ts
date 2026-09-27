// Worker entry point: `pnpm worker <command>`.
import { runMigrations } from "@/shared/db";
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
};

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
