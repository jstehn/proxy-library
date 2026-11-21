import type { WorkerContainer } from "../container";

/** One `pnpm worker <name>` command: it gets the wired-up worker and runs to completion. */
export type Command = (container: WorkerContainer) => Promise<void>;

/** The optional positive whole number after the command name (`embed-cards 50`). */
export function optionalLimit(): number | undefined {
  const raw = process.argv[3];
  if (raw === undefined) return undefined;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`limit must be a positive whole number, got ${raw}`);
  }
  return limit;
}
