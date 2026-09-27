// Shared kernel: tiny, stable, pure building blocks used by every module.
// Nothing here performs I/O. Real adapters live in shared/runtime and shared/db.
export { assertNever } from "./assert-never";
export type { Brand } from "./brand";
export type { Clock } from "./clock";
export { UserId } from "./ids";
export { Cents } from "./money";
export { ok, err } from "./result";
export type { Ok, Err, Result } from "./result";
export { seededRng, randomInt, weightedPick, weightedSample } from "./rng";
export type { Rng, Weighted } from "./rng";
export type { UnitOfWork } from "./unit-of-work";
