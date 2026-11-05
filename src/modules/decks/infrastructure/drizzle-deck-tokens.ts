import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { DeckTokenRepository } from "../application/ports";
import type { DeckId } from "../domain/deck";
import type { TokenChoice } from "../domain/token-proxies";
import { deckTokenChoices } from "./schema";

// The deck's token choices (design doc 25), and what it reads of the catalog's tokens.

export function drizzleDeckTokenRepository(db: DbExecutor): DeckTokenRepository {
  async function tokenOracleOf(tokenId: string): Promise<string | null> {
    const [row] = (
      await db.execute<{ oracle_id: string }>(
        sql`select oracle_id from token_printings where id = ${tokenId}`,
      )
    ).rows;
    return row?.oracle_id ?? null;
  }

  async function anyMakes(
    cardOracleIds: readonly string[],
    tokenOracleId: string,
  ): Promise<boolean> {
    if (cardOracleIds.length === 0) return false;
    const [row] = (
      await db.execute<{ makes: boolean }>(sql`
        select exists (
          select 1
            from printing_tokens pt
            join printings p on p.id = pt.printing_id
            join token_printings t on t.id = pt.token_id
           where p.oracle_id = any(${sql.param([...cardOracleIds])}::text[])
             and t.oracle_id = ${tokenOracleId}
        ) as makes
      `)
    ).rows;
    return row?.makes ?? false;
  }

  async function saveChoice(deckId: DeckId, choice: TokenChoice) {
    await db
      .insert(deckTokenChoices)
      .values({
        deckId,
        tokenOracleId: choice.tokenOracleId,
        tokenId: choice.tokenId,
        included: choice.included,
      })
      .onConflictDoUpdate({
        target: [deckTokenChoices.deckId, deckTokenChoices.tokenOracleId],
        set: { tokenId: choice.tokenId, included: choice.included },
      });
  }

  return { tokenOracleOf, anyMakes, saveChoice };
}
