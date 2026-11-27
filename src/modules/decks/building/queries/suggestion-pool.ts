import { eq, sql } from "drizzle-orm";
import { type DbExecutor, newestDayPrice, textArray } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { formatRules, isCounted, copyLimitFor, bracketLine } from "@/modules/decks/core/client";
import { comboPartnersForDeck, deckView, STANDARD_FIRST } from "@/modules/decks/core";
import { deckEntries, decks } from "@/modules/decks/core/infrastructure/schema";
import { cheapestOfCards } from "./candidate-pool";
import { embedSimForCards } from "./embeddings";
import {
  candidateColumns,
  fitsDeck,
  ownedCandidates,
  ownedCandidatesForIds,
  storeCandidates,
  toCard,
  type CandidateRow,
} from "./suggestion-sql";
import type { CandidatePool, SuggestionContext } from "../domain/suggestion-types";

// The deck suggestions' SQL (design doc 20, section 9; the scoring and ranking are in
// application/suggest-cards.ts). SQL narrows the catalog to a few hundred cards that share
// something with the deck, using the role tags and themes the sync stores on each printing.

/** The deck as the suggestions read it, or null if it isn't this player's. */
export async function suggestionContext(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
): Promise<SuggestionContext | null> {
  const view = await deckView(db, userId, deckId);
  if (view === null) return null;

  const rules = formatRules(view.deck.format);
  const commanders = view.lines.filter((line) => line.board === "commander");
  const identityOf = (oracleIds: string[]) => [
    ...new Set(oracleIds.flatMap((oracleId) => view.rules[oracleId]?.colorIdentity ?? [])),
  ];
  // Commander: the commanders' identity. Otherwise the deck's own colors, if it has any
  // (design doc 20, decision 3).
  const identity = rules.usesColorIdentity
    ? commanders.length > 0
      ? identityOf(commanders.map((line) => line.oracleId))
      : null
    : identityOf(view.lines.map((line) => line.oracleId));
  const colorLimit =
    identity === null || (!rules.usesColorIdentity && identity.length === 0) ? null : identity;

  const countedQuantities = new Map<string, number>();
  for (const line of view.lines) {
    if (!isCounted(line.board)) continue;
    countedQuantities.set(
      line.oracleId,
      (countedQuantities.get(line.oracleId) ?? 0) + line.quantity,
    );
  }
  // Cards at their copy limit (1 in Commander / restricted, 4 in 60-card) won't be re-suggested
  // (design docs 20, 32, & 44). Maybeboard copies are never counted.
  const atLimit: string[] = [];
  for (const [oracleId, qty] of countedQuantities) {
    const rule = view.rules[oracleId];
    const limit = copyLimitFor(view.deck.format, rule) ?? rules.plannedCopyLimit;
    if (qty >= limit) atLimit.push(oracleId);
  }

  return {
    deckId,
    format: view.deck.format,
    usesRealCards: view.deck.usesRealCards,
    colorLimit,
    inDeck: atLimit,
    countedQuantities,
    lines: view.lines,
    commanderOracleIds: rules.hasCommandZone ? commanders.map((line) => line.oracleId) : [],
    targetBracket: view.deck.targetBracket,
    bracketLines: view.lines.map(bracketLine),
  };
}

/** The candidate cards for one player, read from the database. */
export function candidatePool(db: DbExecutor, userId: UserId): CandidatePool {
  return {
    context: (deckId) => suggestionContext(db, userId, deckId),
    comboPartners: (oracleIds, targetBracket) => comboPartnersForDeck(db, oracleIds, targetBracket),
    owned: (context, want, comboPartnerIds) =>
      ownedCandidates(db, userId, context, want, comboPartnerIds),
    store: (context, want, comboPartnerIds) =>
      storeCandidates(db, userId, context, want, comboPartnerIds),
    ownedAmong: (context, oracleIds, maxPriceCents) =>
      ownedCandidatesForIds(db, userId, context, oracleIds, maxPriceCents),
    storeAmong: async (context, oracleIds, maxPriceCents) => {
      const rows = await db.execute<CandidateRow>(sql`
        with cheapest as ${cheapestOfCards(userId, context.usesRealCards, oracleIds, fitsDeck(context), maxPriceCents)}
        select ${candidateColumns(context)}, cheapest.finish, cheapest.usd_cents as price_cents,
               0 as owned, 0 as owned_real, 0 as other_decks, 0 as free,
               null as edhrec_inclusion, null as edhrec_synergy, null as edhrec_total_decks
          from cheapest join printings p on p.id = cheapest.printing_id
      `);
      return rows.rows.map((row) => toCard(row, "store", context));
    },
    similarities: (deckOracleIds, candidateOracleIds) =>
      embedSimForCards(db, deckOracleIds, candidateOracleIds),
    neighbours: async (oracleId, limit) => {
      const [target] = (
        await db.execute<{ vec: string }>(sql`
          select embedding::text as vec
            from card_embeddings
           where oracle_id = ${oracleId}
        `)
      ).rows;
      if (target === undefined) return [];
      const rows = await db.execute<{ oracle_id: string; similarity: number }>(sql`
        select oracle_id, (1 - (embedding <=> ${target.vec}::vector))::float8 as similarity
          from card_embeddings
         where oracle_id <> ${oracleId}
         order by embedding <=> ${target.vec}::vector
         limit ${limit}
      `);
      return rows.rows.map((row) => ({
        oracleId: row.oracle_id,
        similarity: Number(row.similarity),
      }));
    },
    cardLike: async (oracleId, context) => {
      const [targetRow] = (
        await db.execute<CandidateRow>(sql`
          select ${candidateColumns(context)}, 'nonfoil' as finish, null as price_cents,
                 0 as owned, 0 as owned_real, 0 as other_decks, 0 as free,
                 null as edhrec_inclusion, null as edhrec_synergy, null as edhrec_total_decks
            from printings p join card_sets s on s.code = p.set_code
           where p.oracle_id = ${oracleId}
           order by ${STANDARD_FIRST} limit 1
        `)
      ).rows;
      return targetRow === undefined ? null : toCard(targetRow, "store", context);
    },
    deckPlan: async (deckId) => {
      const [profileRows, pinnedRows] = await Promise.all([
        db
          .select({ profileJson: decks.profileJson })
          .from(decks)
          .where(eq(decks.id, deckId))
          .limit(1),
        db
          .select({ oracleId: deckEntries.oracleId, pinned: deckEntries.pinned })
          .from(deckEntries)
          .where(eq(deckEntries.deckId, deckId)),
      ]);
      return {
        plan: profileRows[0]?.profileJson ?? null,
        pinnedOracleIds: new Set(pinnedRows.filter((row) => row.pinned).map((row) => row.oracleId)),
      };
    },
    cheapestPrices: async (oracleIds) => {
      const rows = await db.execute<{
        oracle_id: string;
        name: string;
        type_line: string;
        price_cents: number | null;
      }>(sql`
        select distinct on (p.oracle_id) p.oracle_id, p.name, p.type_line, latest.usd_cents as price_cents
          from printings p
          join card_sets s on s.code = p.set_code and s.is_enabled
          left join lateral (select ${newestDayPrice("p.id")} as usd_cents) latest on true
         where p.oracle_id = any(${textArray(oracleIds)})
         order by p.oracle_id, latest.usd_cents asc nulls last, p.id
      `);
      return rows.rows.map((row) => ({
        oracleId: row.oracle_id,
        name: row.name,
        typeLine: row.type_line,
        priceCents: row.price_cents !== null ? Number(row.price_cents) : null,
      }));
    },
  };
}
