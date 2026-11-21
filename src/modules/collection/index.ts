// The game collection's public API (ADR 0030). The real collection's is `@/modules/collection/real`:
// it is a separate door so lint can keep every game module out of it (design doc 16, rule 1).
export * from "./game";
