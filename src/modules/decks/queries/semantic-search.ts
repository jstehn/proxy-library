import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { rateCard } from "../domain/rate";
import { deckProfile, toRatingProfile } from "../domain/suggest";
import { ownedCopies } from "./owned";
import {
  candidateColumns,
  fitsDeck,
  ownedCandidatesForIds,
  suggestionContext,
  textArray,
  toCard,
  withinTarget,
  type CandidateRow,
  type SuggestionCard,
} from "./suggestions";

export type SemanticSearchPick = Readonly<{
  card: SuggestionCard;
  similarityPct: number;
  rating: number;
  score: number;
}>;

export type SemanticSearchResult = Readonly<{
  concept: string;
  owned: SemanticSearchPick[];
  store: SemanticSearchPick[];
  hiddenOverTarget: number;
}>;

const RRF_K = 60;

function typeRegexClause(terms: readonly string[] | undefined): ReturnType<typeof sql> | null {
  if (!terms || terms.length === 0) return null;
  const cleaned = terms
    .map((t) => t.trim().replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter((t) => t.length > 0);
  if (cleaned.length === 0) return null;
  const pattern = `\\y(${cleaned.join("|")})\\y`;
  return sql`tp.type_line ~* ${pattern}`;
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
  options: {
    concept: string;
    filter?: string;
    types?: readonly string[];
    excludeTypes?: readonly string[];
    maxPriceCents?: number;
    limit?: number;
  },
): Promise<SemanticSearchResult | null> {
  const context = await suggestionContext(db, userId, deckId);
  if (context === null) return null;

  const [queryVec] = await embedder([options.concept]);
  if (!queryVec || queryVec.length === 0) {
    return { concept: options.concept, owned: [], store: [], hiddenOverTarget: 0 };
  }
  const vecLiteral = `[${queryVec.join(",")}]`;
  const limit = Math.max(1, Math.min(25, options.limit ?? 10));

  const includeTypeSql = typeRegexClause(options.types);
  const excludeTypeSql = typeRegexClause(options.excludeTypes);
  const typeConditions = [
    includeTypeSql,
    excludeTypeSql ? sql`not (${excludeTypeSql})` : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);
  const typeWhere =
    typeConditions.length > 0
      ? sql`where exists (
              select 1 from printings tp
               where tp.oracle_id = e.oracle_id
                 and ${sql.join(typeConditions, sql` and `)}
            )`
      : sql``;

  const neighborRows = (
    await db.execute<{ oracle_id: string; similarity: number }>(sql`
      select e.oracle_id, (1 - (e.embedding <=> ${vecLiteral}::vector))::float8 as similarity
        from card_embeddings e
        ${typeWhere}
       order by e.embedding <=> ${vecLiteral}::vector
       limit 300
    `)
  ).rows;
  if (neighborRows.length === 0) {
    return { concept: options.concept, owned: [], store: [], hiddenOverTarget: 0 };
  }

  const simById = new Map(neighborRows.map((row) => [row.oracle_id, Number(row.similarity)]));
  const vecRankById = new Map(neighborRows.map((row, idx) => [row.oracle_id, idx + 1]));
  const neighborIds = neighborRows.map((row) => row.oracle_id);

  // Optional keyword/phrase filter rank for hybrid RRF fusion
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
    filterRows.forEach((row, idx) => filterRankById.set(row.oracle_id, idx + 1));
  }

  const priceFilter =
    options.maxPriceCents !== undefined
      ? sql`and latest.usd_cents <= ${options.maxPriceCents}`
      : sql``;

  const [rawOwned, storeRows] = await Promise.all([
    ownedCandidatesForIds(db, userId, context, neighborIds, options.maxPriceCents),
    db.execute<CandidateRow>(sql`
      with cheapest as (
        select distinct on (p.oracle_id) p.id as printing_id, latest.finish, latest.usd_cents
          from printings p join card_sets s on s.code = p.set_code and s.is_enabled
          join lateral (select distinct on (ps.finish) ps.finish, ps.usd_cents
                          from price_snapshots ps where ps.printing_id = p.id
                         order by ps.finish, ps.day desc) latest on true
         where p.oracle_id = any(${textArray(neighborIds)})
           and ${fitsDeck(context)}
           ${priceFilter}
           and not exists (select 1 from ${ownedCopies(userId, sql`${context.usesRealCards}`)} c
                             join printings op on op.id = c.printing_id
                            where op.oracle_id = p.oracle_id)
         order by p.oracle_id, latest.usd_cents, p.id
      )
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
  const rProfile = toRatingProfile(profile);

  const scorePicks = (pool: SuggestionCard[]): SemanticSearchPick[] =>
    pool
      .map((card) => {
        const sim = simById.get(card.oracleId) ?? 0;
        const rating = rateCard(card, rProfile, {
          targetBracket: context.targetBracket,
          maxCardPriceCents: options.maxPriceCents,
        });
        const vecRank = vecRankById.get(card.oracleId) ?? 301;
        const filterRank = filterRankById.get(card.oracleId);
        const rrf =
          1 / (RRF_K + vecRank) + (filterRank !== undefined ? 1 / (RRF_K + filterRank) : 0);
        const score = trimmedFilter
          ? rrf * 40 + (rating.rating / 100) * 0.25
          : Math.max(0, sim) * 0.75 + (rating.rating / 100) * 0.25;
        return {
          card,
          similarityPct: Math.round(Math.max(0, Math.min(1, sim)) * 100),
          rating: rating.rating,
          score,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.similarityPct - a.similarityPct ||
          a.card.oracleId.localeCompare(b.card.oracleId),
      )
      .slice(0, limit);

  return {
    concept: options.concept,
    owned: scorePicks(ownedSplit.kept),
    store: scorePicks(storeSplit.kept),
    hiddenOverTarget: ownedSplit.over.length + storeSplit.over.length,
  };
}
