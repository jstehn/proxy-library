import { formatRules } from "../domain/format-rules";
import { EMPTY_LIST } from "../domain/suggestion-types";
import {
  fitsDeck,
  CandidateRow,
  candidateColumns,
  toCard,
  ownedCandidatesForIds,
  ownedCandidates,
  storeCandidates,
} from "./suggestion-sql";
import { sql } from "drizzle-orm";
import { type DbExecutor, textArray } from "@/shared/db";
import { type Tag } from "@/shared/card-search";
import { type UserId } from "@/shared/kernel";
import { bracketLine, fitsTarget } from "../domain/brackets";
import { isCounted } from "../domain/deck";
import { copyLimitFor } from "../domain/rules";
import {
  budgetPicks,
  creatureTypes,
  deckProfile,
  rank,
  scoreForDeck,
  scoreForRole,
  scoreLike,
  type CandidateCard,
  type DeckFingerprint,
  type Scored,
} from "../domain/suggest";
import { isLand } from "../domain/stats";
import { comboPartnersForDeck } from "./combos";
import { deckView } from "./decks";
import { embedSimForCards } from "./embeddings";
import { STANDARD_FIRST } from "./owned";
import { cheapestOfCards } from "./candidate-pool";
import type {
  Suggestion,
  SuggestionCard,
  SuggestionContext,
  SuggestionList,
  Wanted,
} from "../domain/suggestion-types";

// Deck suggestions (design doc 20, section 9). SQL narrows the catalog to a few hundred cards
// that share something with the deck, using the role tags and themes the sync stores on each
// printing; the pure scoring in domain/suggest.ts ranks them and says why.

/** The deck as the suggestions read it, or null if it isn't this player's. */
export async function suggestionContext(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
): Promise<SuggestionContext | null> {
  const view = await deckView(db, userId, deckId);
  if (view === null) return null;
  const keywordRows = await db.execute<{ oracle_id: string; keywords: string[] }>(sql`
    select p.oracle_id, array_agg(distinct keyword) as keywords
      from printings p cross join unnest(p.keywords) as keyword
     where p.oracle_id = any(${textArray(view.lines.map((line) => line.oracleId))})
     group by p.oracle_id
  `);
  const keywords = new Map(keywordRows.rows.map((row) => [row.oracle_id, row.keywords]));

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
    lines: view.lines.map((line) => ({ ...line, keywords: keywords.get(line.oracleId) ?? [] })),
    commanderOracleIds: rules.hasCommandZone ? commanders.map((line) => line.oracleId) : [],
    targetBracket: view.deck.targetBracket,
    bracketLines: view.lines.map(bracketLine),
  };
}

/** A pool split into the cards that keep the deck within its target and those that don't. */
type TargetSplit = Readonly<{ kept: SuggestionCard[]; over: SuggestionCard[] }>;

/** Leaves out cards that would take the deck over its target bracket (invariant 10). */
export function withinTarget(
  cards: readonly SuggestionCard[],
  context: SuggestionContext,
): TargetSplit {
  const target = context.targetBracket;
  if (target === null) return { kept: [...cards], over: [] };
  const kept: SuggestionCard[] = [];
  const over: SuggestionCard[] = [];
  for (const card of cards) {
    const flags = bracketLine({ ...card, quantity: 1, board: "main" }).flags;
    (fitsTarget(context.bracketLines, { name: card.name, flags }, target) ? kept : over).push(card);
  }
  return { kept, over };
}

/** How many of the left-out cards would have scored at all: the "hiding N cards" count. */
function countScoring(
  over: readonly SuggestionCard[],
  score: (card: CandidateCard) => Scored | null,
): number {
  return over.filter((card) => score(card) !== null).length;
}

/** The scoring's view of a suggestion card. */
function candidate(card: SuggestionCard): CandidateCard {
  return card;
}

/** Scores a pool, ranks it, and keeps the best `count`. */
function best(
  cards: readonly SuggestionCard[],
  score: (card: CandidateCard) => Scored | null,
  count: number,
): Suggestion[] {
  const byId = new Map(cards.map((card) => [card.oracleId, card]));
  return rank(cards.map((card) => score(candidate(card))))
    .slice(0, count)
    .flatMap((scored) => {
      const card = byId.get(scored.card.oracleId);
      if (card === undefined) return [];
      const rating =
        scored.rating?.rating ??
        Math.max(0, Math.min(100, Math.round(100 / (1 + Math.exp(-scored.score)))));
      return [{ card, reasons: scored.reasons, rating, ratingParts: scored.rating?.parts ?? [] }];
    });
}

function wantedFor(profile: DeckFingerprint): Wanted {
  return {
    roles: profile.gaps.map((gap) => gap.tag),
    themes: profile.themes,
    tribes: profile.tribes,
    keywords: profile.keywords,
  };
}

const nothingWanted = (want: Wanted) =>
  want.roles.length + want.themes.length + want.tribes.length + want.keywords.length === 0;

export type DeckSuggestions = Readonly<{
  profile: DeckFingerprint;
  forDeck: SuggestionList;
  /** One list per role the deck is short of, in the order of the profile's gaps. */
  forRoles: ReadonlyArray<Readonly<{ tag: Tag; count: number; target: number } & SuggestionList>>;
}>;

/** Cards for this deck and for each role it's short of (design doc 20, section 5.1). */
export async function deckSuggestions(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
): Promise<DeckSuggestions | null> {
  const context = await suggestionContext(db, userId, deckId);
  if (context === null) return null;
  const profile = deckProfile(context.lines, context.format);
  const want = wantedFor(profile);
  const comboPartners = formatRules(context.format).bracketsApply
    ? await comboPartnersForDeck(
        db,
        context.lines.filter((line) => isCounted(line.board)).map((line) => line.oracleId),
        context.targetBracket,
      )
    : new Map<string, readonly string[]>();
  const comboPartnerIds = Array.from(comboPartners.keys());
  if (
    nothingWanted(want) &&
    context.commanderOracleIds.length === 0 &&
    comboPartnerIds.length === 0
  ) {
    return { profile, forDeck: EMPTY_LIST, forRoles: [] };
  }

  const [rawOwned, rawStore] = await Promise.all([
    ownedCandidates(db, userId, context, want, comboPartnerIds),
    storeCandidates(db, userId, context, want, comboPartnerIds),
  ]);
  const deckSpellIds = context.lines
    .filter(
      (line) => isCounted(line.board) && (!isLand(line.typeLine) || line.board === "commander"),
    )
    .map((line) => line.oracleId);
  const embedSims = await embedSimForCards(
    db,
    deckSpellIds,
    [...rawOwned, ...rawStore].map((card) => card.oracleId),
  );
  const attachSignals = (cards: SuggestionCard[]): SuggestionCard[] =>
    cards.map((card) => {
      const partners = comboPartners.get(card.oracleId);
      const embedSim = embedSims.get(card.oracleId);
      return {
        ...card,
        ...(partners ? { comboPartners: partners } : {}),
        ...(embedSim !== undefined ? { embedSim } : {}),
      };
    });
  const owned = withinTarget(attachSignals(rawOwned), context);
  const store = withinTarget(attachSignals(rawStore), context);
  const over = [...owned.over, ...store.over];
  const forDeckScore = (card: CandidateCard) =>
    scoreForDeck(card, profile, { targetBracket: context.targetBracket });
  const forDeck = {
    owned: best(owned.kept, forDeckScore, 12),
    store: best(store.kept, forDeckScore, 12),
    hiddenOverTarget: countScoring(over, forDeckScore),
  };
  const forRoles = profile.gaps.map((gap) => {
    const forRoleScore = (card: CandidateCard) => scoreForRole(card, gap.tag, profile);
    return {
      ...gap,
      owned: best(owned.kept, forRoleScore, 6),
      store: best(store.kept, forRoleScore, 6),
      hiddenOverTarget: countScoring(over, forRoleScore),
    };
  });
  return { profile, forDeck, forRoles };
}

/** Cards like one card, for this deck (the selected-card panel). */
export async function similarCards(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  oracleId: string,
): Promise<SuggestionList | null> {
  const context = await suggestionContext(db, userId, deckId);
  if (context === null) return null;
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
  if (targetRow === undefined) return EMPTY_LIST;
  const target = toCard(targetRow, "store", context);
  // Check if the target card has a precomputed embedding for vector nearest-neighbor search.
  const neighborRows = (
    await db.execute<{ oracle_id: string; similarity: number }>(sql`
      select e.oracle_id, (1 - (e.embedding <=> t.embedding))::float8 as similarity
        from card_embeddings t
        join card_embeddings e on e.oracle_id <> t.oracle_id
       where t.oracle_id = ${oracleId}
       order by e.embedding <=> t.embedding
       limit 250
    `)
  ).rows;
  if (neighborRows.length > 0) {
    const simById = new Map(neighborRows.map((row) => [row.oracle_id, Number(row.similarity)]));
    const neighborIds = neighborRows.map((row) => row.oracle_id);
    const withoutTarget = { ...context, inDeck: [...context.inDeck, oracleId] };
    const [ownedCards, storeRows] = await Promise.all([
      ownedCandidatesForIds(db, userId, withoutTarget, neighborIds),
      db.execute<CandidateRow>(sql`
        with cheapest as ${cheapestOfCards(userId, withoutTarget.usesRealCards, neighborIds, fitsDeck(withoutTarget))}
        select ${candidateColumns(withoutTarget)}, cheapest.finish, cheapest.usd_cents as price_cents,
               0 as owned, 0 as owned_real, 0 as other_decks, 0 as free,
               null as edhrec_inclusion, null as edhrec_synergy, null as edhrec_total_decks
          from cheapest join printings p on p.id = cheapest.printing_id
      `),
    ]);
    const owned = withinTarget(ownedCards, withoutTarget);
    const store = withinTarget(
      storeRows.rows.map((row) => toCard(row, "store", withoutTarget)),
      withoutTarget,
    );
    const embedLikeScore = (card: CandidateCard): Scored | null => {
      const sim = simById.get(card.oracleId) ?? 0;
      const base = scoreLike(card, target);
      const reasons: Scored["reasons"][number][] = [
        ...(base?.reasons ?? []),
        { kind: "embedSim", similarityPct: Math.round(sim * 100) },
      ];
      return {
        card,
        score: sim * 10 + (base?.score ?? 0) * 0.25,
        reasons,
      };
    };
    return {
      owned: best(owned.kept, embedLikeScore, 6),
      store: best(store.kept, embedLikeScore, 6),
      hiddenOverTarget: countScoring([...owned.over, ...store.over], embedLikeScore),
    };
  }

  const want: Wanted = {
    roles: target.roles,
    themes: target.themes,
    tribes: creatureTypes(target.typeLine),
    keywords: target.keywords,
  };
  if (nothingWanted(want)) return EMPTY_LIST;
  // The card itself is never like itself: leave it out with the deck's cards.
  const withoutTarget = { ...context, inDeck: [...context.inDeck, oracleId] };
  const [owned, store] = await Promise.all([
    ownedCandidates(db, userId, withoutTarget, want).then((cards) => withinTarget(cards, context)),
    storeCandidates(db, userId, withoutTarget, want).then((cards) => withinTarget(cards, context)),
  ]);
  const likeScore = (card: CandidateCard) => scoreLike(card, target);
  return {
    owned: best(owned.kept, likeScore, 6),
    store: best(store.kept, likeScore, 6),
    hiddenOverTarget: countScoring([...owned.over, ...store.over], likeScore),
  };
}

/** The most cards a budget list holds. */
const BUDGET_LIST_MAXIMUM = 15;

export type BudgetList = Readonly<{
  picks: Suggestion[];
  totalCents: number;
  /** The picks as a list for Buy a list: "1 Name (SET) 123". */
  listText: string;
  /** Store cards left out because they go over the deck's target bracket (design doc 31). */
  hiddenOverTarget: number;
}>;

/** Store cards for this deck within a budget (design doc 20, section 3.2, "Budget"). */
export async function budgetList(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  budgetCents: number,
): Promise<BudgetList | null> {
  const context = await suggestionContext(db, userId, deckId);
  if (context === null) return null;
  const profile = deckProfile(context.lines, context.format);
  const want = wantedFor(profile);
  if (nothingWanted(want) && context.commanderOracleIds.length === 0) {
    return { picks: [], totalCents: 0, listText: "", hiddenOverTarget: 0 };
  }
  const split = withinTarget(await storeCandidates(db, userId, context, want), context);
  const deckSpellIds = context.lines
    .filter(
      (line) => isCounted(line.board) && (!isLand(line.typeLine) || line.board === "commander"),
    )
    .map((line) => line.oracleId);
  const embedSims = await embedSimForCards(
    db,
    deckSpellIds,
    split.kept.map((card) => card.oracleId),
  );
  const store = split.kept.map((card) => {
    const embedSim = embedSims.get(card.oracleId);
    return embedSim !== undefined ? { ...card, embedSim } : card;
  });
  const byId = new Map(store.map((card) => [card.oracleId, card]));
  const scored = rank(
    store.map((card) =>
      scoreForDeck(candidate(card), profile, { targetBracket: context.targetBracket }),
    ),
  );
  const picks = budgetPicks(scored, budgetCents, BUDGET_LIST_MAXIMUM).flatMap((pick) => {
    const card = byId.get(pick.card.oracleId);
    if (card === undefined) return [];
    const rating =
      pick.rating?.rating ??
      Math.max(0, Math.min(100, Math.round(100 / (1 + Math.exp(-pick.score)))));
    return [{ card, reasons: pick.reasons, rating, ratingParts: pick.rating?.parts ?? [] }];
  });
  return {
    picks,
    totalCents: picks.reduce((sum, pick) => sum + (pick.card.priceCents ?? 0), 0),
    listText: picks
      .map(
        ({ card }) =>
          `1 ${card.name} (${card.setCode.toUpperCase()}) ${card.collectorNumber}${card.finish === "nonfoil" ? "" : card.finish === "foil" ? " *F*" : " *E*"}`,
      )
      .join("\n"),
    hiddenOverTarget: countScoring(split.over, (card) =>
      scoreForDeck(card, profile, { targetBracket: context.targetBracket }),
    ),
  };
}
