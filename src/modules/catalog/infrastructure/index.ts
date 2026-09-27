// Real implementations of the catalog ports. Only composition roots import this file.
export { drizzleCatalogRepository, drizzleSyncRunRepository } from "./drizzle-repositories";
// File-based gateways over the recorded fixtures: for tests, and for loading sample data offline.
export { fixtureMtgjsonGateway, fixtureScryfallGateway } from "./fixture-gateways";
export {
  diskImageStore,
  httpImageFetcher,
  httpMtgjsonGateway,
  httpScryfallGateway,
} from "./gateways";
