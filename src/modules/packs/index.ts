// The packs module's public API: the only file other modules and the app may import.
export { loadBooster, openBooster, type LoadedBooster } from "./application/open-booster";

export { makePacks } from "./application/make-packs";
export { valueBooster } from "./application/value-booster";
export type { Packs } from "./application/make-packs";
export type { BoosterKey, PacksServices, SeedSource } from "./application/ports";
export type { SimulateOpeningsError } from "./application/simulate";
export type { BoosterUnavailable, CountInvalid } from "./domain/errors";
export { openPack } from "./domain/generate";
export { COUNT_KEYS, expectedPackValue, type CountKey } from "./domain/odds";
export type { FactsLookup, Pack, PackCard, PrintingFacts } from "./domain/pack";
export { SIMULATION_LIMIT, type SimulationReport } from "./domain/report";
export type { BoosterChoice } from "./queries/boosters";
export * as packsQueries from "./queries";
