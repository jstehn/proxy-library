// Real implementations of the catalog ports. Only composition roots import this file.
export { drizzleArtworkRepository } from "../cards/infrastructure/drizzle-artwork";
export { drizzleCardFeatureStore } from "../cards/infrastructure/drizzle-card-features";
export { drizzleEdhrecRepository } from "../outside/infrastructure/drizzle-edhrec";
export { drizzleEmbeddingRepository } from "../outside/infrastructure/drizzle-embeddings";
export { drizzleComprehensiveRulesRepository } from "../rules/infrastructure/drizzle-rules";
export { drizzleSpellbookRepository } from "../outside/infrastructure/drizzle-spellbook";
export {
  drizzleCatalogRepository,
  drizzleSyncRunRepository,
} from "../cards/infrastructure/drizzle-repositories";
export { huggingFaceTextEmbedder } from "../outside/infrastructure/embedder";
export { httpEdhrecGateway } from "../outside/infrastructure/edhrec-gateway";
export { httpComprehensiveRulesGateway } from "../rules/infrastructure/rules-gateway";
export { makeOutsideData, type OutsideDataService } from "../outside/infrastructure/outside-data";
export { httpSpellbookGateway } from "../outside/infrastructure/spellbook-gateway";
// File-based gateways over the recorded fixtures: for tests, and for loading sample data offline.
export {
  fixtureMtgjsonGateway,
  fixtureScryfallGateway,
} from "../cards/infrastructure/fixture-gateways";
export { fixtureWpnGateway, httpWpnGateway, memoryArtworkStore } from "../cards/infrastructure/wpn";
export {
  diskArtworkStore,
  diskImageStore,
  httpImageFetcher,
  httpMtgjsonGateway,
  httpScryfallGateway,
} from "../cards/infrastructure/gateways";
