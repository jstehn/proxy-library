import type { BoosterConfig, PrintingId } from "@/modules/catalog";
import { inMemoryUnitOfWork } from "@/shared/kernel/testing";
import type { BoosterKey, BoosterSource, PacksServices, SeedSource } from "../application/ports";
import type { PrintingFacts } from "../domain/pack";

/** A BoosterSource over recipes and facts held in memory. */
export function inMemoryBoosterSource(
  configs: readonly BoosterConfig[],
  facts: ReadonlyMap<PrintingId, PrintingFacts>,
): BoosterSource {
  async function boosterConfig(key: BoosterKey): Promise<BoosterConfig | null> {
    const found = configs.find(
      (config) => config.setCode === key.setCode && config.boosterType === key.boosterType,
    );
    return found ?? null;
  }

  async function printingFacts(
    printingIds: readonly PrintingId[],
  ): Promise<Map<PrintingId, PrintingFacts>> {
    const found = new Map<PrintingId, PrintingFacts>();
    for (const printingId of printingIds) {
      const printing = facts.get(printingId);
      if (printing !== undefined) found.set(printingId, printing);
    }
    return found;
  }

  async function boosterKeys(): Promise<BoosterKey[]> {
    return configs.map((config) => ({ setCode: config.setCode, boosterType: config.boosterType }));
  }

  return { boosterConfig, printingFacts, boosterKeys };
}

/** Everything the pack use cases need, in memory. Seeds are "seed-1", "seed-2", … */
export function inMemoryPacksServices(
  configs: readonly BoosterConfig[],
  facts: ReadonlyMap<PrintingId, PrintingFacts>,
) {
  const services: PacksServices = { boosters: inMemoryBoosterSource(configs, facts) };
  let seedsHandedOut = 0;
  const seeds: SeedSource = {
    newSeed: () => {
      seedsHandedOut += 1;
      return `seed-${seedsHandedOut}`;
    },
  };
  return { services, unitOfWork: inMemoryUnitOfWork(services), seeds };
}
