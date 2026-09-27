import type { BoosterConfig, PrintingId, SetCode } from "@/modules/catalog";
import type { UnitOfWork } from "@/shared/kernel";
import type { PrintingFacts } from "../domain/pack";

// Ports: what the pack use cases need from outside (design doc 05, section 6).

/** Which booster: a set and one of its booster types, e.g. BLB "play". */
export type BoosterKey = Readonly<{ setCode: SetCode; boosterType: string }>;

/** Reads booster recipes and printing facts from the catalog's tables. */
export interface BoosterSource {
  /** The recipe, or null if there's none. Works for disabled sets too (owned packs stay openable). */
  boosterConfig(key: BoosterKey): Promise<BoosterConfig | null>;
  /** Facts for these printings, in one query. Unknown ids are simply missing from the map. */
  printingFacts(printingIds: readonly PrintingId[]): Promise<Map<PrintingId, PrintingFacts>>;
  /** Every recipe of every enabled set. */
  boosterKeys(): Promise<BoosterKey[]>;
}

/** Where fresh seeds come from: the operating system in production, fixed strings in tests. */
export interface SeedSource {
  newSeed(): string;
}

/** The repositories that must share one transaction. */
export type PacksServices = {
  boosters: BoosterSource;
};

export type PacksDependencies = {
  unitOfWork: UnitOfWork<PacksServices>;
  seeds: SeedSource;
};
