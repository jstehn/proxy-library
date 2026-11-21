import {
  formatRules,
  isAvoidCard,
  isCounted,
  isKeyCard,
  isLand,
} from "@/modules/decks/core/client";
import {
  budgetPicks,
  deckProfile,
  rank,
  rankBudgetReplacements,
  scoreForDeck,
  scoreForRole,
  scoreLike,
  type CandidateCard,
  type DeckFingerprint,
  type Scored,
} from "@/modules/decks/scoring/client";
import { creatureTypes, hasTypeWord, type Tag } from "@/shared/kernel";
import {
  EMPTY_LIST,
  withinTarget,
  type CandidatePool,
  type BudgetReplacementPick,
  type BudgetReplacementsResult,
  type ExpensiveCardReplacements,
  type Suggestion,
  type SuggestionCard,
  type SuggestionContext,
  type SuggestionList,
  type Wanted,
} from "../domain/suggestion-types";

// Deck suggestions (design doc 20, section 9). The candidate pool narrows the catalog to a few
// hundred cards that share something with the deck; the pure scoring in scoring/domain/suggest.ts
// ranks them and says why. This file decides which pool calls to make and how to score the result.

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
      return [{ card, reasons: scored.reasons, rating: scored.rating }];
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

/** The oracle ids of the deck's counted spells (and commanders), for the embedding comparison. */
function spellIdsOf(context: SuggestionContext): string[] {
  return context.lines
    .filter(
      (line) => isCounted(line.board) && (!isLand(line.typeLine) || line.board === "commander"),
    )
    .map((line) => line.oracleId);
}

export type DeckSuggestions = Readonly<{
  profile: DeckFingerprint;
  forDeck: SuggestionList;
  /** One list per role the deck is short of, in the order of the profile's gaps. */
  forRoles: ReadonlyArray<Readonly<{ tag: Tag; count: number; target: number } & SuggestionList>>;
}>;

/** Cards for this deck and for each role it's short of (design doc 20, section 5.1). */
export async function deckSuggestions(
  pool: CandidatePool,
  deckId: number,
): Promise<DeckSuggestions | null> {
  const context = await pool.context(deckId);
  if (context === null) return null;
  const profile = deckProfile(context.lines, context.format);
  const want = wantedFor(profile);
  const comboPartners = formatRules(context.format).bracketsApply
    ? await pool.comboPartners(
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
    pool.owned(context, want, comboPartnerIds),
    pool.store(context, want, comboPartnerIds),
  ]);
  const embedSims = await pool.similarities(
    spellIdsOf(context),
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
    const forRoleScore = (card: CandidateCard) =>
      scoreForRole(card, gap.tag, profile, { targetBracket: context.targetBracket });
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
  pool: CandidatePool,
  deckId: number,
  oracleId: string,
): Promise<SuggestionList | null> {
  const context = await pool.context(deckId);
  if (context === null) return null;
  const target = await pool.cardLike(oracleId, context);
  if (target === null) return EMPTY_LIST;
  // Check if the target card has a precomputed embedding for vector nearest-neighbor search.
  const neighbours = await pool.neighbours(oracleId, 250);
  if (neighbours.length > 0) {
    const simById = new Map(neighbours.map((row) => [row.oracleId, row.similarity]));
    const neighbourIds = neighbours.map((row) => row.oracleId);
    const withoutTarget = { ...context, inDeck: [...context.inDeck, oracleId] };
    const [ownedCards, storeCards] = await Promise.all([
      pool.ownedAmong(withoutTarget, neighbourIds),
      pool.storeAmong(withoutTarget, neighbourIds),
    ]);
    const owned = withinTarget(ownedCards, withoutTarget);
    const store = withinTarget(storeCards, withoutTarget);
    // The card's text similarity to the target is one more input of the one scorer.
    const embedLikeScore = (card: CandidateCard) =>
      scoreLike({ ...card, embedSim: simById.get(card.oracleId) ?? 0 }, target);
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
    pool.owned(withoutTarget, want).then((cards) => withinTarget(cards, context)),
    pool.store(withoutTarget, want).then((cards) => withinTarget(cards, context)),
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
  pool: CandidatePool,
  deckId: number,
  budgetCents: number,
): Promise<BudgetList | null> {
  const context = await pool.context(deckId);
  if (context === null) return null;
  const profile = deckProfile(context.lines, context.format);
  const want = wantedFor(profile);
  if (nothingWanted(want) && context.commanderOracleIds.length === 0) {
    return { picks: [], totalCents: 0, listText: "", hiddenOverTarget: 0 };
  }
  const split = withinTarget(await pool.store(context, want), context);
  const embedSims = await pool.similarities(
    spellIdsOf(context),
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
    return card === undefined ? [] : [{ card, reasons: pick.reasons, rating: pick.rating }];
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

export type BudgetReplacementOptions = Readonly<{
  oracleId?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  limitPerCard?: number;
  limitCards?: number;
}>;

const REANIMATE_RE =
  /\b(?:return|put)\b[^.]*\bfrom (?:your |a |any )?graveyard\b[^.]*\bonto the battlefield\b/i;
const PRIMARY_TYPES = ["Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Planeswalker"];

/**
 * Finds cheaper legal replacements for expensive cards in a deck using `card_embeddings`
 * cosine similarity blended with `rateCard` deck fit (design doc 53).
 */
export async function budgetReplacements(
  pool: CandidatePool,
  deckId: number,
  options: BudgetReplacementOptions = {},
): Promise<BudgetReplacementsResult | null> {
  const context = await pool.context(deckId);
  if (context === null) return null;
  const { plan: deckPlanProfile, pinnedOracleIds } = await pool.deckPlan(deckId);
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

  const targetRows = await pool.cheapestPrices(targetIds);

  const expensiveTargets = targetRows
    .filter((row) => {
      if (options.oracleId) return row.oracleId === options.oracleId;
      if (isKeyCard(row.name, deckPlanProfile, pinnedOracleIds.has(row.oracleId))) return false;
      return row.priceCents !== null && row.priceCents >= minPriceCents;
    })
    .sort((a, b) => (b.priceCents ?? 0) - (a.priceCents ?? 0))
    .slice(0, options.oracleId ? 1 : limitCards);

  const cards: ExpensiveCardReplacements[] = [];
  for (const target of expensiveTargets) {
    const targetPriceCents = target.priceCents !== null ? target.priceCents : minPriceCents;
    const effectiveMaxPrice = Math.min(maxPriceCents, Math.max(1, targetPriceCents - 1));

    const neighbours = await pool.neighbours(target.oracleId, 300);
    if (neighbours.length === 0) continue;

    const simById = new Map(neighbours.map((row) => [row.oracleId, row.similarity]));
    const neighbourIds = neighbours.map((row) => row.oracleId);

    const [rawOwnedCards, rawStoreCards] = await Promise.all([
      pool.ownedAmong(context, neighbourIds, effectiveMaxPrice),
      pool.storeAmong(context, neighbourIds, effectiveMaxPrice),
    ]);

    const targetLine = context.lines.find((l) => l.oracleId === target.oracleId);
    const targetRoles: readonly Tag[] = targetLine?.roles ?? [];

    const targetText = targetLine?.text ?? "";
    const isReanimate = REANIMATE_RE.test(targetText);
    const targetPrimaryTypes = PRIMARY_TYPES.filter((t) => hasTypeWord(target.typeLine, [t]));

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
    const storeCards = filterCandidates(withinTarget(rawStoreCards, context).kept);

    const toReplacementPicks = (candidates: SuggestionCard[]): BudgetReplacementPick[] => {
      const byId = new Map(candidates.map((card) => [card.oracleId, card]));
      return rankBudgetReplacements(
        { priceCents: targetPriceCents },
        candidates.map((card) => ({ card, similarity: simById.get(card.oracleId) ?? 0 })),
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
        oracleId: target.oracleId,
        name: target.name,
        priceCents: targetPriceCents,
        typeLine: target.typeLine,
      },
      owned: toReplacementPicks(ownedCards),
      store: toReplacementPicks(storeCards),
    });
  }

  return { cards, minPriceCents, maxPriceCents };
}
