import { makeCheckBoosters } from "./check-boosters";
import type { PacksDependencies } from "./ports";
import { makeSimulateOpenings } from "./simulate";

/**
 * Builds the pack use cases from one set of dependencies. (Opening a pack for a player is
 * `openBooster`, which runs inside the caller's transaction, so it isn't built here.)
 */
export function makePacks(dependencies: PacksDependencies) {
  return {
    simulateOpenings: makeSimulateOpenings(dependencies),
    checkBoosters: makeCheckBoosters(dependencies),
  };
}

export type Packs = ReturnType<typeof makePacks>;
