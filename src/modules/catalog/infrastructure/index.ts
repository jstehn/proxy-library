// Real implementations of the catalog ports. Only composition roots import this file.
export { drizzleArtworkRepository } from "./drizzle-artwork";
export { drizzleCatalogRepository, drizzleSyncRunRepository } from "./drizzle-repositories";
// File-based gateways over the recorded fixtures: for tests, and for loading sample data offline.
export { fixtureMtgjsonGateway, fixtureScryfallGateway } from "./fixture-gateways";
export { fixtureWpnGateway, httpWpnGateway, memoryArtworkStore } from "./wpn";
export {
  diskArtworkStore,
  diskImageStore,
  httpImageFetcher,
  httpMtgjsonGateway,
  httpScryfallGateway,
} from "./gateways";
