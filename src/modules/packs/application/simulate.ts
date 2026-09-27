import type { Actor } from "@/modules/accounts";
import { err, ok, type Result } from "@/shared/kernel";
import type { BoosterUnavailable, CountInvalid, Forbidden } from "../domain/errors";
import { openPack } from "../domain/generate";
import { SIMULATION_LIMIT, summarizeOpenings, type SimulationReport } from "../domain/report";
import { loadBooster, type LoadedBooster } from "./open-booster";
import type { BoosterKey, PacksDependencies } from "./ports";

export type SimulateOpeningsError = Forbidden | BoosterUnavailable | CountInvalid;
export type SimulateOpeningsInput = BoosterKey & Readonly<{ count: number }>;

/** The seed of the n-th pack in a run, derived from the run's seed so the whole run replays. */
export function packSeed(runSeed: string, packNumber: number): string {
  return `${runSeed}-${packNumber}`;
}

/** The Pack lab: open up to 1,000 packs, keep nothing, report on the odds (admins only). */
export function makeSimulateOpenings(dependencies: PacksDependencies) {
  const { unitOfWork, seeds } = dependencies;

  async function simulateOpenings(
    actor: Actor,
    input: SimulateOpeningsInput,
  ): Promise<Result<SimulationReport, SimulateOpeningsError>> {
    if (!actor.isAdmin) return err({ kind: "Forbidden" });
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > SIMULATION_LIMIT) {
      return err({ kind: "CountInvalid" });
    }

    const loaded = await unitOfWork.run<LoadedBooster | null, never>(async (services) =>
      ok(await loadBooster(services, input)),
    );
    if (!loaded.ok || loaded.value === null) return err({ kind: "BoosterUnavailable" });
    const { config, facts } = loaded.value;

    const seed = seeds.newSeed();
    const packs = Array.from({ length: input.count }, (_, index) =>
      openPack(config, facts, packSeed(seed, index + 1)),
    );
    return ok(summarizeOpenings({ config, facts, seed, packs }));
  }

  return simulateOpenings;
}
