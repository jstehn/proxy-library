import {
  fitsDeck,
  CandidateRow,
  candidateColumns,
  toCard,
  ownedCandidatesForIds,
} from "@/modules/decks/building";
import { suggestionContext, withinTarget } from "./suggestions";
import { eq, sql } from "drizzle-orm";
import { type DbExecutor, newestDayPrice, textArray } from "@/shared/db";
import { hasTypeWord, type Tag, type UserId } from "@/shared/kernel";
import { isCounted } from "../domain/deck";
import { isAvoidCard, isKeyCard, type DeckPlan } from "../domain/deck-profile";
import { deckEntries, decks } from "../infrastructure/schema";
import { deckProfile } from "@/modules/decks/scoring/client";
import { rankBudgetReplacements } from "@/modules/decks/scoring/client";
import { isLand } from "../domain/stats";
import { cheapestOfCards } from "@/modules/decks/building";
import type {
  BudgetReplacementPick,
  BudgetReplacementsResult,
  ExpensiveCardReplacements,
  SuggestionCard,
} from "@/modules/decks/building/client";

/**
 * Finds cheaper legal replacements for expensive cards in a deck using `card_embeddings`
 * cosine similarity blended with `rateCard` deck fit (design doc 53).
 */
export async function budgetReplacements(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  options: {
    oracleId?: string;
    minPriceCents?: number;
    maxPriceCents?: number;
    limitPerCard?: number;
    limitCards?: number;
  } = {},
): Promise<BudgetReplacementsResult | null> {
  const context = await suggestionContext(db, userId, deckId);
  if (context === null) return null;
  const [profileRows, pinnedRows] = await Promise.all([
    db.select({ profileJson: decks.profileJson }).from(decks).where(eq(decks.id, deckId)).limit(1),
    db
      .select({ oracleId: deckEntries.oracleId, pinned: deckEntries.pinned })
      .from(deckEntries)
      .where(eq(deckEntries.deckId, deckId)),
  ]);
  const deckPlanProfile: DeckPlan | null = profileRows[0]?.profileJson ?? null;
  const pinnedSet = new Set(pinnedRows.filter((r) => r.pinned).map((r) => r.oracleId));
  const minPriceCents = options.minPriceCents ?? 500;
  const maxPriceCents = options.maxPriceCents ?? 200;
  const limitPerCard = options.limitPerCard ?? 5;
  const limitCards = options.limitCards ?? 5;

  const profile = deckProfile(context.lines, context.format);

  // Determine target expensive non-land cards in the deck
  const targetIds = options.oracleId
    ? [options.oracleId]
    : context.lines
        .filter((line) => isCounted(line.board) && !isLand(line.typeLine))
        .map((line) => line.oracleId);

  if (targetIds.length === 0) {
    return { cards: [], minPriceCents, maxPriceCents };
  }

  const targetRows = (
    await db.execute<{
      oracle_id: string;
      name: string;
      type_line: string;
      price_cents: number | null;
    }>(sql`
      select distinct on (p.oracle_id) p.oracle_id, p.name, p.type_line, latest.usd_cents as price_cents
        from printings p
        join card_sets s on s.code = p.set_code and s.is_enabled
        left join lateral (select ${newestDayPrice("p.id")} as usd_cents) latest on true
       where p.oracle_id = any(${textArray(targetIds)})
       order by p.oracle_id, latest.usd_cents asc nulls last, p.id
    `)
  ).rows;

  const expensiveTargets = targetRows
    .filter((row) => {
      if (options.oracleId) return row.oracle_id === options.oracleId;
      if (isKeyCard(row.name, deckPlanProfile, pinnedSet.has(row.oracle_id))) return false;
      return row.price_cents !== null && Number(row.price_cents) >= minPriceCents;
    })
    .sort((a, b) => Number(b.price_cents ?? 0) - Number(a.price_cents ?? 0))
    .slice(0, options.oracleId ? 1 : limitCards);

  const cards: ExpensiveCardReplacements[] = [];
  for (const target of expensiveTargets) {
    const targetPriceCents =
      target.price_cents !== null ? Number(target.price_cents) : minPriceCents;
    const effectiveMaxPrice = Math.min(maxPriceCents, Math.max(1, targetPriceCents - 1));

    const neighborRows = (
      await db.execute<{ oracle_id: string; similarity: number }>(sql`
        select e.oracle_id, (1 - (e.embedding <=> t.embedding))::float8 as similarity
          from card_embeddings t
          join card_embeddings e on e.oracle_id <> t.oracle_id
         where t.oracle_id = ${target.oracle_id}
         order by e.embedding <=> t.embedding
         limit 300
      `)
    ).rows;
    if (neighborRows.length === 0) continue;

    const simById = new Map(neighborRows.map((row) => [row.oracle_id, Number(row.similarity)]));
    const neighborIds = neighborRows.map((row) => row.oracle_id);

    const [rawOwnedCards, storeRows] = await Promise.all([
      ownedCandidatesForIds(db, userId, context, neighborIds, effectiveMaxPrice),
      db.execute<CandidateRow>(sql`
        with cheapest as ${cheapestOfCards(userId, context.usesRealCards, neighborIds, fitsDeck(context), effectiveMaxPrice)}
        select ${candidateColumns(context)}, cheapest.finish, cheapest.usd_cents as price_cents,
               0 as owned, 0 as owned_real, 0 as other_decks, 0 as free,
               null as edhrec_inclusion, null as edhrec_synergy, null as edhrec_total_decks
          from cheapest join printings p on p.id = cheapest.printing_id
      `),
    ]);

    const targetLine = context.lines.find((l) => l.oracleId === target.oracle_id);
    const targetRoles: readonly Tag[] = targetLine?.roles ?? [];

    const targetText = targetLine?.text ?? "";
    const REANIMATE_RE =
      /\b(?:return|put)\b[^.]*\bfrom (?:your |a |any )?graveyard\b[^.]*\bonto the battlefield\b/i;
    const isReanimate = REANIMATE_RE.test(targetText);
    const PRIMARY_TYPES = [
      "Creature",
      "Instant",
      "Sorcery",
      "Artifact",
      "Enchantment",
      "Planeswalker",
    ];
    const targetPrimaryTypes = PRIMARY_TYPES.filter((t) => hasTypeWord(target.type_line, [t]));

    const filterCandidates = (list: SuggestionCard[]) => {
      const base = list.filter((c) => !isAvoidCard(c.name, deckPlanProfile));
      if (targetRoles.length > 0) {
        return base.filter((c) => c.roles.some((r) => targetRoles.includes(r)));
      }
      if (isReanimate) {
        const reanimators = base.filter((c) => REANIMATE_RE.test(c.text));
        if (reanimators.length > 0) return reanimators;
      }
      if (targetPrimaryTypes.length > 0) {
        const sameType = base.filter((c) =>
          targetPrimaryTypes.some((t) => hasTypeWord(c.typeLine, [t])),
        );
        if (sameType.length > 0) return sameType;
      }
      return base;
    };

    const ownedCards = filterCandidates(withinTarget(rawOwnedCards, context).kept);
    const storeCards = filterCandidates(
      withinTarget(
        storeRows.rows.map((row) => toCard(row, "store", context)),
        context,
      ).kept,
    );

    const toReplacementPicks = (pool: SuggestionCard[]): BudgetReplacementPick[] => {
      const byId = new Map(pool.map((card) => [card.oracleId, card]));
      return rankBudgetReplacements(
        { priceCents: targetPriceCents },
        pool.map((card) => ({ card, similarity: simById.get(card.oracleId) ?? 0 })),
        profile,
        {
          targetBracket: context.targetBracket,
          maxPriceCents: effectiveMaxPrice,
          limit: limitPerCard,
        },
      ).flatMap((pick) => {
        const card = byId.get(pick.card.oracleId);
        if (!card) return [];
        const matchedRoles = targetRoles.filter((r) => card.roles.includes(r));
        return [
          {
            card,
            savedCents: pick.savedCents,
            matchedRoles,
          },
        ];
      });
    };

    cards.push({
      target: {
        oracleId: target.oracle_id,
        name: target.name,
        priceCents: targetPriceCents,
        typeLine: target.type_line,
      },
      owned: toReplacementPicks(ownedCards),
      store: toReplacementPicks(storeCards),
    });
  }

  return { cards, minPriceCents, maxPriceCents };
}
