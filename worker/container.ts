// Composition root for the worker process (scheduled data sync, migrations).
// Shares its wiring with the app via buildCore; sync jobs are added in Phase 4.
import { buildCore } from "@/server/core";
import { loadConfig } from "@/shared/config";

export function createWorkerContainer() {
  return buildCore(loadConfig());
}

export type WorkerContainer = ReturnType<typeof createWorkerContainer>;
