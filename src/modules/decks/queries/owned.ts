import { sql, type SQL } from "drizzle-orm";
import type { UserId } from "@/shared/kernel";

// Which copies count as a player's in a deck (design doc 16, rule 2): every game copy, plus their
// real copies when the deck's "Use my real cards" switch is on. The only place outside the real
// collection that reads its table (rule 1); selling, trading and the store never see it.

/**
 * SQL: a table of the copies `userId` counts as theirs, with the columns user_id, printing_id,
 * finish, quantity and is_real. `withReal` is a boolean SQL expression: whether real copies
 * count (a deck's switch, or `true` to have both and tell them apart by is_real).
 */
export function ownedCopies(userId: UserId, withReal: SQL): SQL {
  return sql`(select user_id, printing_id, finish, quantity, false as is_real
                from collection_cards where user_id = ${userId}
              union all
              select user_id, printing_id, finish, quantity, true as is_real
                from real_cards where user_id = ${userId} and ${withReal})`;
}

/** SQL: whether deck `deckId` counts real copies. */
export function deckUsesRealCards(deckId: number): SQL {
  return sql`coalesce((select d.uses_real_cards from decks d where d.id = ${deckId}), false)`;
}
