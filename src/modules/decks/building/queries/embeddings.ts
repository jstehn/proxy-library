import { sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";

function pgTextArray(values: readonly string[]): SQL {
  return sql`array[${sql.join(
    [...values, "_"].map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

/**
 * Mean of top-5 cosine similarities between each candidate and the deck's non-land/commander
 * cards, using precomputed `card_embeddings` (design doc 53, #58). Returns an empty map if no
 * embeddings exist yet.
 */
export async function embedSimForCards(
  db: DbExecutor,
  deckOracleIds: readonly string[],
  candidateOracleIds: readonly string[],
): Promise<Map<string, number>> {
  const uniqueDeck = [...new Set(deckOracleIds)];
  const uniqueCandidates = [...new Set(candidateOracleIds)];
  if (uniqueDeck.length === 0 || uniqueCandidates.length === 0) return new Map();

  const rows = (
    await db.execute<{ oracle_id: string; embed_sim: number }>(sql`
      select c.oracle_id, avg(s.sim)::float8 as embed_sim
        from card_embeddings c
        join lateral (
          select 1 - (c.embedding <=> d.embedding) as sim
            from card_embeddings d
           where d.oracle_id = any(${pgTextArray(uniqueDeck)})
             and d.oracle_id <> c.oracle_id
           order by c.embedding <=> d.embedding
           limit 5
        ) s on true
       where c.oracle_id = any(${pgTextArray(uniqueCandidates)})
       group by c.oracle_id
    `)
  ).rows;

  return new Map(rows.map((row) => [row.oracle_id, Number(row.embed_sim)]));
}
