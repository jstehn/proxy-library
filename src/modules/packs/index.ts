// The packs module's public API: the only file other modules and the app may import.
export { openBooster } from "./application/open-booster";

export { makePacks } from "./application/make-packs";
export { valueBooster } from "./application/value-booster";
export type { Packs } from "./application/make-packs";
export type { PacksServices, SeedSource } from "./application/ports";
export type { SimulateOpeningsError } from "./application/simulate";
export type { BoosterUnavailable, CountInvalid } from "./domain/errors";
export { COUNT_KEYS, expectedPackValue, type CountKey } from "./domain/odds";
export type { Pack, PackCard, PrintingFacts } from "./domain/pack";
export { SIMULATION_LIMIT, type SimulationReport } from "./domain/report";
export { availableBoosters, type BoosterChoice } from "./queries/boosters";
