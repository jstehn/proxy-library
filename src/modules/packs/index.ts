// The packs module's public API: the only file other modules and the app may import.
export { loadBooster, openBooster } from "./application/open-booster";
export type { LoadedBooster, OpenBoosterInput } from "./application/open-booster";
export type { BoosterCheck } from "./application/check-boosters";
export { makePacks } from "./application/make-packs";
export type { Packs } from "./application/make-packs";
export type {
  BoosterKey,
  BoosterSource,
  PacksDependencies,
  PacksServices,
  SeedSource,
} from "./application/ports";
export type { SimulateOpeningsError, SimulateOpeningsInput } from "./application/simulate";
export type { BoosterUnavailable, CountInvalid } from "./domain/errors";
export { COUNT_KEYS, type CountKey, type PerPackCounts } from "./domain/odds";
export type { Pack, PackCard, PrintingFacts } from "./domain/pack";
export { SIMULATION_LIMIT, type Pull, type SimulationReport } from "./domain/report";
export { availableBoosters, type BoosterChoice } from "./queries/boosters";
