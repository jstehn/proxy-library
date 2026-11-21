import type { Clock, UnitOfWork, CardFacts, CardIdentity } from "@/shared/kernel";
import type { EdhrecCommanderPage } from "../domain/edhrec";
import type { SpellbookTwoCardCombo } from "../domain/spellbook";

// Ports: what the outside-data area needs from outside (design docs 52, 53 and 60).

export interface EdhrecGateway {
  /** Fetch and Zod-parse one commander's EDHREC page, or null on 404. */
  commanderPage(slug: string): Promise<EdhrecCommanderPage | null>;
}

export interface EdhrecRepository {
  /** Commanders to refresh: those in player decks/precons first, then enabled sets, missing or stale. */
  commandersToSync(
    staleBefore: Date,
    limit: number,
  ): Promise<ReadonlyArray<{ oracleId: string; name: string }>>;
  /** Resolve card names to oracle_ids in our catalog. */
  resolveOracleIdsByName(names: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** Upsert commander metadata and replace its card entries atomically. */
  saveCommanderData(
    commanderOracleId: string,
    slug: string,
    status: "ok" | "not_found",
    totalDecks: number,
    entries: ReadonlyArray<{ cardOracleId: string; inclusionRate: number; synergy: number }>,
    fetchedAt: Date,
  ): Promise<void>;
}

/** Commander Spellbook bulk two-card combo feed (design doc 52, ADR 0025). */
export interface SpellbookGateway {
  fetchTwoCardCombos(): Promise<readonly SpellbookTwoCardCombo[]>;
}

export interface SpellbookRepository {
  lastSyncedAt(): Promise<Date | null>;
  replaceTwoCardCombos(combos: readonly SpellbookTwoCardCombo[], syncedAt: Date): Promise<void>;
}

/** Local text embedding model adapter (design doc 53, #58). */
export type TextEmbedder = (texts: readonly string[]) => Promise<number[][]>;

export type CardTextToEmbed = Pick<CardIdentity, "oracleId"> &
  Pick<CardFacts, "name" | "typeLine" | "text">;

export type CardEmbeddingRow = Readonly<{
  oracleId: string;
  model: string;
  textVersion: number;
  embedding: number[];
  updatedAt: Date;
}>;

export interface EmbeddingRepository {
  listMissingOrStale(
    model: string,
    textVersion: number,
    limit?: number,
  ): Promise<CardTextToEmbed[]>;
  upsertBatch(rows: readonly CardEmbeddingRow[]): Promise<void>;
}

/** What the outside syncs read and write. Each repository is optional: a host may leave one out. */
export type OutsideServices = {
  edhrec?: EdhrecRepository;
  spellbook?: SpellbookRepository;
  embeddings?: EmbeddingRepository;
};

export type OutsideDependencies = {
  unitOfWork: UnitOfWork<OutsideServices>;
  edhrec?: EdhrecGateway;
  spellbook?: SpellbookGateway;
  textEmbedder?: TextEmbedder;
  clock: Clock;
};
