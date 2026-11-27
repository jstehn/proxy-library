import { sql } from "drizzle-orm";
import { latestPrice, textArray, type DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { rateCard, deckProfile } from "@/modules/decks/scoring/client";
import { cheapestOfCards, ownedPerCard } from "./candidate-pool";
import {
  candidateColumns,
  fitsDeck,
  ownedCandidatesForIds,
  toCard,
  type CandidateRow,
} from "./suggestion-sql";
import { suggestionContext } from "./suggestion-pool";
import { withinTarget, type SuggestionCard } from "../domain/suggestion-types";

export type SemanticCard = Readonly<{
  oracleId: string;
  name: string;
  typeLine: string;
  manaCost: string | null;
  priceCents: number | null;
  text: string;
}>;

export type SemanticSearchPick = Readonly<{
  card: SemanticCard;
  similarityPct: number;
  score: number;
}>;

export type SemanticSearchResult = Readonly<{
  concept: string;
  owned: SemanticSearchPick[];
  store: SemanticSearchPick[];
  hiddenOverTarget: number;
}>;

type SemanticQueryOptions = Readonly<{
  concept: string;
  filter?: string;
  types?: readonly string[];
  excludeTypes?: readonly string[];
  maxPriceCents?: number;
  limit?: number;
  where?: "owned" | "store" | "both";
}>;

type NeighborLookup = Readonly<{
  neighborIds: string[];
  simById: Map<string, number>;
  vecRankById: Map<string, number>;
  filterRankById: Map<string, number>;
  trimmedFilter: string | undefined;
}>;

const RRF_K = 60;

function typeRegexClause(terms: readonly string[] | undefined): ReturnType<typeof sql> | null {
  if (!terms || terms.length === 0) return null;
  const cleaned = terms
    .map((term) => term.trim().replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter((term) => term.length > 0);
  if (cleaned.length === 0) return null;
  const pattern = `\\y(${cleaned.join("|")})\\y`;
  return sql`tp.type_line ~* ${pattern}`;
}

async function nearestOracleIds(
  db: DbExecutor,
  embedder: (texts: readonly string[]) => Promise<number[][]>,
  options: SemanticQueryOptions,
): Promise<NeighborLookup | null> {
  const [queryVec] = await embedder([options.concept]);
  if (!queryVec || queryVec.length === 0) return null;

  const vecLiteral = `[${queryVec.join(",")}]`;
  const includeTypeSql = typeRegexClause(options.types);
  const excludeTypeSql = typeRegexClause(options.excludeTypes);
  const typeConditions = [
    includeTypeSql,
    excludeTypeSql ? sql`not (${excludeTypeSql})` : null,
  ].filter((condition): condition is NonNullable<typeof condition> => condition !== null);
  const typeWhere =
    typeConditions.length > 0
      ? sql`where exists (
              select 1 from printings tp
               where tp.oracle_id = e.oracle_id
                 and ${sql.join(typeConditions, sql` and `)}
            )`
      : sql``;

  const neighborRows = await db.transaction(async (transaction) => {
    await transaction.execute(sql`set local hnsw.ef_search = 300`);
    await transaction.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
    return (
      await transaction.execute<{ oracle_id: string; similarity: number }>(sql`
        select e.oracle_id, (1 - (e.embedding <=> ${vecLiteral}::vector))::float8 as similarity
          from card_embeddings e
          ${typeWhere}
         order by e.embedding <=> ${vecLiteral}::vector
         limit 300
      `)
    ).rows;
  });
  if (neighborRows.length === 0) return null;

  const simById = new Map(neighborRows.map((row) => [row.oracle_id, Number(row.similarity)]));
  const vecRankById = new Map(neighborRows.map((row, index) => [row.oracle_id, index + 1]));
  const neighborIds = neighborRows.map((row) => row.oracle_id);

  // Optional keyword/phrase filter rank for hybrid RRF fusion.
  const filterRankById = new Map<string, number>();
  const trimmedFilter = options.filter?.trim();
  if (trimmedFilter) {
    const pattern = `%${trimmedFilter}%`;
    const filterRows = (
      await db.execute<{ oracle_id: string }>(sql`
        select distinct p.oracle_id
          from printings p
         where p.oracle_id = any(${textArray(neighborIds)})
           and (p.name ilike ${pattern}
                or p.type_line ilike ${pattern}
                or exists (select 1 from jsonb_array_elements(p.faces) f
                            where f->>'text' ilike ${pattern}))
         limit 100
      `)
    ).rows;
    filterRows.forEach((row, index) => filterRankById.set(row.oracle_id, index + 1));
  }

  return { neighborIds, simById, vecRankById, filterRankById, trimmedFilter };
}

function rankSemanticPicks<T extends SemanticCard>(
  pool: readonly T[],
  lookup: NeighborLookup,
  limit: number,
  computeScore: (card: T, sim: number, rrf: number, hasFilter: boolean) => number,
): SemanticSearchPick[] {
  const hasFilter = Boolean(lookup.trimmedFilter);
  return pool
    .map((card) => {
      const sim = lookup.simById.get(card.oracleId) ?? 0;
      const vecRank = lookup.vecRankById.get(card.oracleId) ?? 301;
      const filterRank = lookup.filterRankById.get(card.oracleId);
      const rrf = 1 / (RRF_K + vecRank) + (filterRank !== undefined ? 1 / (RRF_K + filterRank) : 0);
      return {
        card,
        similarityPct: Math.round(Math.max(0, Math.min(1, sim)) * 100),
        score: computeScore(card, sim, rrf, hasFilter),
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.similarityPct - a.similarityPct ||
        a.card.oracleId.localeCompare(b.card.oracleId),
    )
    .slice(0, limit);
}

/**
 * Natural-language concept search for a deck (design doc 54): embeds `concept`, queries
 * `card_embeddings` with `pgvector` cosine similarity, optionally fuses with a `filter` text
 * match via Reciprocal Rank Fusion (RRF), and scores with `rateCard`.
 */
export async function semanticSearchForDeck(
  db: DbExecutor,
  embedder: (texts: readonly string[]) => Promise<number[][]>,
  userId: UserId,
  deckId: number,
  options: SemanticQueryOptions,
): Promise<SemanticSearchResult | null> {
  const context = await suggestionContext(db, userId, deckId);
  if (context === null) return null;

  const lookup = await nearestOracleIds(db, embedder, options);
  if (lookup === null) {
    return { concept: options.concept, owned: [], store: [], hiddenOverTarget: 0 };
  }
  const limit = Math.max(1, Math.min(25, options.limit ?? 10));
  const where = options.where ?? "both";

  const [rawOwned, storeRows] = await Promise.all([
    where === "store"
      ? Promise.resolve<SuggestionCard[]>([])
      : ownedCandidatesForIds(db, userId, context, lookup.neighborIds, options.maxPriceCents),
    where === "owned"
      ? Promise.resolve({ rows: [] as CandidateRow[] })
      : db.execute<CandidateRow>(sql`
          with cheapest as ${cheapestOfCards(userId, context.usesRealCards, lookup.neighborIds, fitsDeck(context), options.maxPriceCents)}
          select ${candidateColumns(context)}, cheapest.finish, cheapest.usd_cents as price_cents,
                 0 as owned, 0 as owned_real, 0 as other_decks, 0 as free,
                 null as edhrec_inclusion, null as edhrec_synergy, null as edhrec_total_decks
            from cheapest join printings p on p.id = cheapest.printing_id
        `),
  ]);

  const ownedSplit = withinTarget(rawOwned, context);
  const storeSplit = withinTarget(
    storeRows.rows.map((row) => toCard(row, "store", context)),
    context,
  );

  const profile = deckProfile(context.lines, context.format);
  const scoreForDeck = (card: SuggestionCard, sim: number, rrf: number, hasFilter: boolean) => {
    const rating = rateCard(card, profile, {
      targetBracket: context.targetBracket,
      maxCardPriceCents: options.maxPriceCents,
    });
    return hasFilter
      ? rrf * 40 + (rating.rating / 100) * 0.25
      : Math.max(0, sim) * 0.75 + (rating.rating / 100) * 0.25;
  };

  return {
    concept: options.concept,
    owned: rankSemanticPicks(ownedSplit.kept, lookup, limit, scoreForDeck),
    store: rankSemanticPicks(storeSplit.kept, lookup, limit, scoreForDeck),
    hiddenOverTarget: ownedSplit.over.length + storeSplit.over.length,
  };
}

type CatalogSemanticRow = {
  oracle_id: string;
  name: string;
  type_line: string;
  mana_cost: string | null;
  price_cents: string | number | null;
  text: string | null;
};

function toSemanticCard(row: CatalogSemanticRow): SemanticCard {
  return {
    oracleId: row.oracle_id,
    name: row.name,
    typeLine: row.type_line,
    manaCost: row.mana_cost,
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    text: row.text ?? "",
  };
}

/**
 * Natural-language concept search across the player's collection and/or store without requiring a
 * deck. Ranks matches by pgvector cosine similarity (with optional hybrid RRF filter).
 */
export async function semanticSearchCatalog(
  db: DbExecutor,
  embedder: (texts: readonly string[]) => Promise<number[][]>,
  userId: UserId,
  options: SemanticQueryOptions,
): Promise<SemanticSearchResult> {
  const lookup = await nearestOracleIds(db, embedder, options);
  if (lookup === null) {
    return { concept: options.concept, owned: [], store: [], hiddenOverTarget: 0 };
  }
  const limit = Math.max(1, Math.min(25, options.limit ?? 10));
  const where = options.where ?? "both";
  const maxPriceClause =
    options.maxPriceCents === undefined
      ? sql`true`
      : sql`coalesce(price.usd_cents, 0) <= ${options.maxPriceCents}`;

  const [ownedRows, storeRows] = await Promise.all([
    where === "store"
      ? Promise.resolve({ rows: [] as CatalogSemanticRow[] })
      : db.execute<CatalogSemanticRow>(sql`
          select p.oracle_id, p.name, p.type_line, p.mana_cost,
                 price.usd_cents as price_cents,
                 coalesce((select string_agg(f->>'text', E'\n')
                             from jsonb_array_elements(p.faces) f), '') as text
            from ${ownedPerCard(userId, false, lookup.neighborIds)} o
            join printings p on p.id = o.printing_id
            left join lateral ${latestPrice("o.printing_id", "o.finish")} price on true
           where ${maxPriceClause}
        `),
    where === "owned"
      ? Promise.resolve({ rows: [] as CatalogSemanticRow[] })
      : db.execute<CatalogSemanticRow>(sql`
          with cheapest as ${cheapestOfCards(userId, false, lookup.neighborIds, sql`true`, options.maxPriceCents)}
          select p.oracle_id, p.name, p.type_line, p.mana_cost,
                 cheapest.usd_cents as price_cents,
                 coalesce((select string_agg(f->>'text', E'\n')
                             from jsonb_array_elements(p.faces) f), '') as text
            from cheapest
            join printings p on p.id = cheapest.printing_id
        `),
  ]);

  const scoreCatalog = (_card: SemanticCard, sim: number, rrf: number, hasFilter: boolean) =>
    hasFilter ? rrf * 40 : Math.max(0, sim);

  return {
    concept: options.concept,
    owned: rankSemanticPicks(ownedRows.rows.map(toSemanticCard), lookup, limit, scoreCatalog),
    store: rankSemanticPicks(storeRows.rows.map(toSemanticCard), lookup, limit, scoreCatalog),
    hiddenOverTarget: 0,
  };
}
