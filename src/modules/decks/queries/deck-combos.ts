import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import type { DeckCombo } from "../domain/brackets";
import { isCounted } from "../domain/deck";
import { comboPartnersForDeck, combosForDeck } from "./combos";
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

export type OneCardAwayCombo = Readonly<{
  card: SuggestionCard;
  partnersWith: readonly string[];
}>;

export type DeckCombosView = Readonly<{
  complete: readonly DeckCombo[];
  oneCardAway: Readonly<{
    owned: OneCardAwayCombo[];
    store: OneCardAwayCombo[];
    hiddenOverTarget: number;
  }>;
}>;

/**
 * Full combo view for a deck: complete 2-card combos in the deck + 1-card-away partners
 * available in the player's collection or store, filtered by `targetBracket` (design doc 54).
 */
export async function deckCombosView(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  limit = 15,
): Promise<DeckCombosView | null> {
  const context = await suggestionContext(db, userId, deckId);
  if (context === null) return null;

  const playedIds = context.lines
    .filter((line) => isCounted(line.board))
    .map((line) => line.oracleId);

  const [complete, partnerMap] = await Promise.all([
    combosForDeck(db, playedIds),
    comboPartnersForDeck(db, playedIds, context.targetBracket),
  ]);

  const partnerIds = Array.from(partnerMap.keys());
  if (partnerIds.length === 0) {
    return {
      complete: complete ?? [],
      oneCardAway: { owned: [], store: [], hiddenOverTarget: 0 },
    };
  }

  const [rawOwned, storeRows] = await Promise.all([
    ownedCandidatesForIds(db, userId, context, partnerIds),
    db.execute<CandidateRow>(sql`
      with cheapest as (
        select distinct on (p.oracle_id) p.id as printing_id, latest.finish, latest.usd_cents
          from printings p join card_sets s on s.code = p.set_code and s.is_enabled
          join lateral (select distinct on (ps.finish) ps.finish, ps.usd_cents
                          from price_snapshots ps where ps.printing_id = p.id
                         order by ps.finish, ps.day desc) latest on true
         where p.oracle_id = any(${textArray(partnerIds)})
           and ${fitsDeck(context)}
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

  const toComboList = (cards: SuggestionCard[]): OneCardAwayCombo[] =>
    cards
      .map((card) => ({
        card,
        partnersWith: partnerMap.get(card.oracleId) ?? [],
      }))
      .sort(
        (a, b) =>
          b.partnersWith.length - a.partnersWith.length ||
          (a.card.priceCents ?? 999_999) - (b.card.priceCents ?? 999_999) ||
          a.card.name.localeCompare(b.card.name),
      )
      .slice(0, limit);

  return {
    complete: complete ?? [],
    oneCardAway: {
      owned: toComboList(ownedSplit.kept),
      store: toComboList(storeSplit.kept),
      hiddenOverTarget: ownedSplit.over.length + storeSplit.over.length,
    },
  };
}
