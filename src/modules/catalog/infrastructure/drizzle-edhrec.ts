import { eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { EdhrecRepository } from "../application/ports";
import { edhrecCommanderCards, edhrecCommanders } from "./schema";

const INSERT_BATCH_SIZE = 500;

export function drizzleEdhrecRepository(db: DbExecutor): EdhrecRepository {
  return {
    async commandersToSync(staleBefore: Date, limit: number) {
      if (limit <= 0) return [];
      const rows = await db.execute<{ oracle_id: string; name: string }>(sql`
        with candidates as (
          select distinct on (p.oracle_id)
                 p.oracle_id,
                 p.name,
                 p.edhrec_rank,
                 (ec.commander_oracle_id is null) as unsynced,
                 exists (
                   select 1 from deck_entries e
                    where e.oracle_id = p.oracle_id and e.board = 'commander'
                 ) as in_deck
            from printings p
            join card_sets s on s.code = p.set_code
            left join edhrec_commanders ec on ec.commander_oracle_id = p.oracle_id
           where (s.is_enabled or s.is_supporting)
             and coalesce(p.legalities->>'commander', 'legal') in ('legal', 'restricted')
             and (
               (p.type_line ~ '\\mLegendary\\M' and p.type_line ~ '\\mCreature\\M')
               or exists (
                 select 1 from jsonb_array_elements(p.faces) f
                  where f->>'text' ~* 'can be your commander'
               )
             )
             and (ec.commander_oracle_id is null or ec.fetched_at < ${staleBefore})
           order by p.oracle_id, p.edhrec_rank asc nulls last
        )
        select oracle_id, name
          from candidates
         order by in_deck desc, unsynced desc, edhrec_rank asc nulls last, name
         limit ${limit}
      `);
      return rows.rows.map((row) => ({ oracleId: row.oracle_id, name: row.name }));
    },

    async resolveOracleIdsByName(names: readonly string[]) {
      const lowered = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
      if (lowered.length === 0) return new Map();

      const nameArray = sql`array[${sql.join(
        lowered.map((n) => sql`${n}`),
        sql`, `,
      )}]::text[]`;

      const rows = await db.execute<{ key: string; oracle_id: string }>(sql`
        select distinct on (k.key) k.key, p.oracle_id
          from printings p
         cross join lateral (
           values (lower(p.name)), (lower(split_part(p.name, ' // ', 1)))
         ) as k(key)
         where k.key = any(${nameArray})
         order by k.key, p.oracle_id
      `);

      return new Map(rows.rows.map((row) => [row.key, row.oracle_id]));
    },

    async saveCommanderData(commanderOracleId, slug, status, totalDecks, entries, fetchedAt) {
      await db
        .insert(edhrecCommanders)
        .values({
          commanderOracleId,
          slug,
          status,
          totalDecks,
          fetchedAt,
        })
        .onConflictDoUpdate({
          target: edhrecCommanders.commanderOracleId,
          set: { slug, status, totalDecks, fetchedAt },
        });

      await db
        .delete(edhrecCommanderCards)
        .where(eq(edhrecCommanderCards.commanderOracleId, commanderOracleId));

      for (let i = 0; i < entries.length; i += INSERT_BATCH_SIZE) {
        const chunk = entries.slice(i, i + INSERT_BATCH_SIZE);
        await db.insert(edhrecCommanderCards).values(
          chunk.map((entry) => ({
            commanderOracleId,
            cardOracleId: entry.cardOracleId,
            inclusionRate: entry.inclusionRate,
            synergy: entry.synergy,
          })),
        );
      }
    },
  };
}
