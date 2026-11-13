// Real implementations of the catalog ports. Only composition roots import this file.
export { drizzleArtworkRepository } from "./drizzle-artwork";
export { drizzleEdhrecRepository } from "./drizzle-edhrec";
export { drizzleEmbeddingRepository } from "./drizzle-embeddings";
export { drizzleSpellbookRepository } from "./drizzle-spellbook";
export { drizzleCatalogRepository, drizzleSyncRunRepository } from "./drizzle-repositories";
export { huggingFaceTextEmbedder } from "./embedder";
export { httpEdhrecGateway } from "./edhrec-gateway";
export { httpSpellbookGateway } from "./spellbook-gateway";
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
