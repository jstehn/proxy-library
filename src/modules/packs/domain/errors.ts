export type Forbidden = Readonly<{ kind: "Forbidden" }>;
/** No booster recipe for that set and booster type (or its set isn't enabled). */
export type BoosterUnavailable = Readonly<{ kind: "BoosterUnavailable" }>;
/** Simulation size outside 1–SIMULATION_LIMIT. */
export type CountInvalid = Readonly<{ kind: "CountInvalid" }>;
