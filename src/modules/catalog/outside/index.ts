// What the other areas and the module root use of catalog/outside (ADR 0030): data from other
// sites (EDHREC, Commander Spellbook, Scryfall rulings) and the card text embeddings.
export { EMBEDDING_DIMS, EMBEDDING_MODEL, EMBEDDING_TEXT_VERSION } from "./domain/embedding-text";
export type {
  EdhrecCardItem,
  ScryfallRuling,
  ScryfallRulingsResult,
  EdhrecCommanderData,
  SpellbookCombo,
  SpellbookCombosResult,
} from "./domain/outside-data";
export { makeEdhrecSync, type EdhrecSyncSummary } from "./application/edhrec";
export { makeSpellbookSync, type SpellbookSyncSummary } from "./application/spellbook";
export { makeEmbedCards } from "./application/embed";
export type {
  EdhrecGateway,
  OutsideDependencies,
  OutsideServices,
  SpellbookGateway,
  TextEmbedder,
} from "./application/ports";
