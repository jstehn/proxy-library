// The catalog module's public API: the only file other modules and the app may import. Each area
// (ADR 0030) says what it offers in its own index.ts.
export * from "./cards";
export * from "./outside";
export * from "./rules";
export { makeCatalog } from "./make-catalog";
export type { Catalog } from "./make-catalog";
