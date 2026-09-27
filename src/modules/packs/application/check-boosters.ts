import { ok, seededRng } from "@/shared/kernel";
import { packProblems } from "../domain/checks";
import { generatePack } from "../domain/generate";
import { loadBooster, type LoadedBooster } from "./open-booster";
import type { BoosterKey, PacksDependencies } from "./ports";
import { packSeed } from "./simulate";

/** What `check-packs` found for one recipe. */
export type BoosterCheck = BoosterKey &
  Readonly<{
    packsOpened: number;
    /** Distinct problems found, at most 5, each with how many packs had it. */
    problems: ReadonlyArray<{ problem: string; packs: number }>;
  }>;

const PROBLEMS_SHOWN = 5;

/**
 * Opens `packsPerBooster` packs of every real recipe and checks each one (design doc 05,
 * section 12). A recipe the engine can't open at all is reported, not thrown.
 */
export function makeCheckBoosters(dependencies: PacksDependencies) {
  const { unitOfWork } = dependencies;

  async function checkOne(booster: LoadedBooster, packsPerBooster: number): Promise<BoosterCheck> {
    const { config, facts } = booster;
    const problemCounts = new Map<string, number>();
    for (let packNumber = 1; packNumber <= packsPerBooster; packNumber++) {
      let problems: string[];
      try {
        const pack = generatePack(config, seededRng(packSeed("check", packNumber)), facts);
        problems = packProblems(config, pack, facts);
      } catch (error) {
        problems = [`could not open: ${error instanceof Error ? error.message : String(error)}`];
      }
      for (const problem of problems) {
        problemCounts.set(problem, (problemCounts.get(problem) ?? 0) + 1);
      }
    }
    return {
      setCode: config.setCode,
      boosterType: config.boosterType,
      packsOpened: packsPerBooster,
      problems: [...problemCounts]
        .sort((a, b) => b[1] - a[1])
        .slice(0, PROBLEMS_SHOWN)
        .map(([problem, packs]) => ({ problem, packs })),
    };
  }

  async function checkBoosters(packsPerBooster: number): Promise<BoosterCheck[]> {
    const keys = await unitOfWork.run<BoosterKey[], never>(async ({ boosters }) =>
      ok(await boosters.boosterKeys()),
    );
    if (!keys.ok) return [];

    const results: BoosterCheck[] = [];
    for (const key of keys.value) {
      // One short transaction per recipe, so a long check never holds the database.
      const loaded = await unitOfWork.run<LoadedBooster | null, never>(async (services) =>
        ok(await loadBooster(services, key)),
      );
      if (loaded.ok && loaded.value !== null) {
        results.push(await checkOne(loaded.value, packsPerBooster));
      }
    }
    return results;
  }

  return checkBoosters;
}
