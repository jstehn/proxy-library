import { max } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { SpellbookRepository } from "../application/ports";
import type { SpellbookTwoCardCombo } from "../domain/spellbook";
import { spellbookTwoCardCombos } from "./schema";

const INSERT_BATCH_SIZE = 500;

export function drizzleSpellbookRepository(db: DbExecutor): SpellbookRepository {
  return {
    async lastSyncedAt() {
      const [row] = await db
        .select({ latest: max(spellbookTwoCardCombos.syncedAt) })
        .from(spellbookTwoCardCombos);
      return row?.latest ?? null;
    },

    async replaceTwoCardCombos(combos, syncedAt) {
      await db.delete(spellbookTwoCardCombos);
      for (let i = 0; i < combos.length; i += INSERT_BATCH_SIZE) {
        const chunk = combos.slice(i, i + INSERT_BATCH_SIZE);
        await db.insert(spellbookTwoCardCombos).values(
          chunk.map((c) => ({
            id: c.id,
            oracleIdA: c.oracleIdA,
            oracleIdB: c.oracleIdB,
            cardNameA: c.cardNameA,
            cardNameB: c.cardNameB,
            produces: [...c.produces],
            bracketTag: c.bracketTag,
            manaValue: c.manaValue,
            forcesBracket: c.forcesBracket,
            syncedAt,
          })),
        );
      }
    },
  };
}
