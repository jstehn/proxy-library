import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/shared/db";
import { TAGS, THEMES, type Tag, type Theme } from "@/shared/card-search";
import type { UserId } from "@/shared/kernel";
import { bracketLine, fitsTarget, type Bracket, type BracketLine } from "../domain/brackets";
import { isCounted, type Format } from "../domain/deck";
import {
  budgetPicks,
  creatureTypes,
  deckProfile,
  rank,
  scoreForDeck,
  scoreForRole,
  scoreLike,
  type CandidateCard,
  type DeckProfile,
  type ProfileLine,
  type Scored,
} from "../domain/suggest";
import type { BrowseCard } from "./browse";
import { deckView } from "./decks";
import { ownedCopies, STANDARD_FIRST } from "./owned";

// Deck suggestions (design doc 20, section 9). SQL narrows the catalog to a few hundred cards
// that share something with the deck, using the role tags and themes the sync stores on each
// printing; the pure scoring in domain/suggest.ts ranks them and says why.

const ColorSchema = z.enum(["W", "U", "B", "R", "G"]);
const FinishSchema = z.enum(["nonfoil", "foil", "etched"]);

/** How many candidates SQL hands to the scoring, per pool. */
const CANDIDATE_LIMIT = 400;

/** A suggested card: everything the builder's grid shows (so it can be selected and added). */
export type SuggestionCard = BrowseCard &
  Readonly<{
    pool: "owned" | "store";
    keywords: string[];
    roles: Tag[];
    themes: Theme[];
    rarity: string;
  }>;

export type Suggestion = Readonly<{
  card: SuggestionCard;
  reasons: Scored["reasons"];
}>;

/** One list of suggestions: cards you own first, then cards in the store. */
export type SuggestionList = Readonly<{
  owned: Suggestion[];
  store: Suggestion[];
  /** Cards that would have been suggested but go over the deck's target bracket (design doc 31). */
  hiddenOverTarget: number;
}>;

const EMPTY_LIST: SuggestionList = { owned: [], store: [], hiddenOverTarget: 0 };

/** What the queries need to know about a deck. */
type SuggestionContext = Readonly<{
  deckId: number;
  format: Format;
  /** Whether real copies count as owned here (design doc 16). */
  usesRealCards: boolean;
  /** Colors a suggestion's identity must stay within, or null for any. */
  colorLimit: Array<z.infer<typeof ColorSchema>> | null;
  /** Oracle cards already in the deck, never suggested. */
  inDeck: string[];
  lines: ProfileLine[];
  /** The bracket the owner chose (Commander only), and the deck as the estimate reads it. */
  targetBracket: Bracket | null;
  bracketLines: BracketLine[];
}>;

/** What a candidate must share with the deck (any one of these). */
type Wanted = Readonly<{
  roles: readonly Tag[];
  themes: readonly Theme[];
  tribes: readonly string[];
  keywords: readonly string[];
}>;

function textArray(values: readonly string[]): SQL {
  return sql`array[${sql.join(
    [...values, "_"].map((value) => sql`${value}`), // "_" keeps an empty array typed
    sql`, `,
  )}]::text[]`;
}

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

  const commanders = view.lines.filter((line) => line.board === "commander");
  const identityOf = (oracleIds: string[]) => [
    ...new Set(oracleIds.flatMap((oracleId) => view.rules[oracleId]?.colorIdentity ?? [])),
  ];
  // Commander: the commanders' identity. Otherwise the deck's own colors, if it has any
  // (design doc 20, decision 3).
  const identity =
    view.deck.format === "commander"
      ? commanders.length > 0
        ? identityOf(commanders.map((line) => line.oracleId))
        : null
      : identityOf(view.lines.map((line) => line.oracleId));
  const colorLimit =
    identity === null || (view.deck.format !== "commander" && identity.length === 0)
      ? null
      : identity;

  return {
    deckId,
    format: view.deck.format,
    usesRealCards: view.deck.usesRealCards,
    colorLimit,
    // A card on the maybeboard can still be suggested (design doc 32, invariant 1).
    inDeck: [
      ...new Set(view.lines.filter((line) => isCounted(line.board)).map((line) => line.oracleId)),
    ],
    lines: view.lines.map((line) => ({ ...line, keywords: keywords.get(line.oracleId) ?? [] })),
    targetBracket: view.deck.targetBracket,
    bracketLines: view.lines.map(bracketLine),
  };
}

/** A pool split into the cards that keep the deck within its target and those that don't. */
type TargetSplit = Readonly<{ kept: SuggestionCard[]; over: SuggestionCard[] }>;

/** Leaves out cards that would take the deck over its target bracket (invariant 10). */
function withinTarget(cards: readonly SuggestionCard[], context: SuggestionContext): TargetSplit {
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

/** The conditions every suggestion meets (invariant 2), on a printing `p`. */
function fitsDeck(context: SuggestionContext): SQL {
  const identity =
    context.colorLimit === null
      ? sql`true`
      : sql`p.color_identity <@ ${textArray(context.colorLimit)}`;
  const legal =
    context.format === "casual"
      ? sql`true`
      : sql`coalesce(p.legalities->>${context.format}, 'legal') in ('legal', 'restricted')`;
  return sql`${identity} and ${legal}
    and not (p.oracle_id = any(${textArray(context.inDeck)}))
    and p.type_line !~ '^Basic\\y.*\\yLand\\y'`;
}

/** Creature types are words; anything else is dropped before it reaches a pattern. */
function tribePattern(tribes: readonly string[]): string | null {
  const safe = tribes.filter((tribe) => /^[A-Za-z][A-Za-z'-]*$/.test(tribe));
  return safe.length === 0 ? null : `\\m(${safe.join("|")})\\M`;
}

/** How many kinds of thing a printing shares with what's wanted: SQL's rough first cut. */
function sharedCount(want: Wanted): SQL {
  const tribes = tribePattern(want.tribes);
  return sql`((p.role_tags && ${textArray(want.roles)})::int
            + (p.theme_tags && ${textArray(want.themes)})::int
            + (p.keywords && ${textArray(want.keywords)})::int
            + ${tribes === null ? sql`0` : sql`(split_part(p.type_line, ' // ', 1) ~ ${tribes} or 'Changeling' = any(p.keywords))::int`})`;
}

type CandidateRow = {
  oracle_id: string;
  printing_id: string;
  name: string;
  mana_cost: string | null;
  mana_value: number;
  type_line: string;
  rarity: string;
  keywords: string[];
  role_tags: string[];
  theme_tags: string[];
  color_identity: string[];
  legality: string | null;
  face_text: string;
  has_power_toughness: boolean;
  is_basic_land: boolean;
  produced_mana: string[] | null;
  is_game_changer: boolean;
  set_code: string;
  collector_number: string;
  finish: string;
  price_cents: number | null;
  owned: number;
  owned_real: number;
  other_decks: number;
  free: number;
};

/** The columns a candidate row needs, from a printing `p` (its card) and a finish `finish`. */
function candidateColumns(context: SuggestionContext): SQL {
  return sql`p.oracle_id, p.id as printing_id, p.name, p.mana_cost, p.mana_value, p.type_line,
    p.rarity, p.keywords, p.role_tags, p.theme_tags, p.color_identity,
    p.legalities->>${context.format} as legality,
    coalesce((select string_agg(f->>'text', ' ') from jsonb_array_elements(p.faces) f), '') as face_text,
    exists (select 1 from jsonb_array_elements(p.faces) f
             where f->>'power' is not null and f->>'toughness' is not null) as has_power_toughness,
    p.type_line ~ '^Basic\\y.*\\yLand\\y' as is_basic_land,
    p.produced_mana, p.is_game_changer, p.set_code, p.collector_number`;
}

/** Cards you own that share something with what's wanted: one per oracle card. */
async function ownedCandidates(
  db: DbExecutor,
  userId: UserId,
  context: SuggestionContext,
  want: Wanted,
): Promise<SuggestionCard[]> {
  const rows = await db.execute<CandidateRow>(sql`
    with owned as (
      select p.oracle_id, sum(c.quantity)::int as owned,
             coalesce(sum(c.quantity) filter (where c.is_real), 0)::int as owned_real,
             (array_agg(c.printing_id order by c.quantity desc, c.printing_id))[1] as printing_id,
             (array_agg(c.finish order by c.quantity desc, c.printing_id))[1] as finish
        from ${ownedCopies(userId, sql`${context.usesRealCards}`)} c join printings p on p.id = c.printing_id
       group by p.oracle_id
    )
    select ${candidateColumns(context)}, owned.finish, owned.owned, owned.owned_real,
           (select s.usd_cents from price_snapshots s
             where s.printing_id = p.id and s.finish = owned.finish
             order by s.day desc limit 1) as price_cents,
           (select count(distinct e.deck_id) from deck_entries e join decks d on d.id = e.deck_id
             where d.owner_id = ${userId} and d.id <> ${context.deckId}
               and e.oracle_id = owned.oracle_id and e.board <> 'maybe')::int as other_decks,
           greatest(owned.owned - coalesce((select sum(e.quantity) from deck_entries e
                                              join decks d on d.id = e.deck_id
                                             where d.owner_id = ${userId} and d.id <> ${context.deckId}
                                               and e.oracle_id = owned.oracle_id
                                               and e.board <> 'maybe'), 0), 0)::int as free
      from owned join printings p on p.id = owned.printing_id
     where ${fitsDeck(context)} and ${sharedCount(want)} > 0
     order by ${sharedCount(want)} desc, p.name
     limit ${CANDIDATE_LIMIT}
  `);
  return rows.rows.map((row) => toCard(row, "owned", context.format));
}

/**
 * Cards in the store (an enabled set, with a price) that share something with what's wanted and
 * that you don't own in any printing: each at its cheapest printing and finish (invariant 3).
 */
async function storeCandidates(
  db: DbExecutor,
  userId: UserId,
  context: SuggestionContext,
  want: Wanted,
): Promise<SuggestionCard[]> {
  const rows = await db.execute<CandidateRow>(sql`
    with matching as (
      select distinct on (p.oracle_id) p.oracle_id, ${sharedCount(want)} as shared,
             case p.rarity when 'mythic' then 3 when 'rare' then 2 when 'uncommon' then 1 else 0 end
               as rarity_rank
        from printings p join card_sets s on s.code = p.set_code and s.is_enabled
       where ${fitsDeck(context)} and ${sharedCount(want)} > 0
         and not exists (select 1 from ${ownedCopies(userId, sql`${context.usesRealCards}`)} c
                           join printings op on op.id = c.printing_id
                          where op.oracle_id = p.oracle_id)
       order by p.oracle_id, rarity_rank desc
    ),
    kept as (
      select oracle_id from matching
       order by shared desc, rarity_rank desc, oracle_id
       limit ${CANDIDATE_LIMIT}
    ),
    cheapest as (
      select kept.oracle_id, best.printing_id, best.finish, best.usd_cents
        from kept
        join lateral (
          select p.id as printing_id, latest.finish, latest.usd_cents
            from printings p join card_sets s on s.code = p.set_code and s.is_enabled
            join lateral (select distinct on (ps.finish) ps.finish, ps.usd_cents
                            from price_snapshots ps where ps.printing_id = p.id
                           order by ps.finish, ps.day desc) latest on true
           where p.oracle_id = kept.oracle_id
           order by latest.usd_cents, p.id
           limit 1
        ) best on true
    )
    select ${candidateColumns(context)}, cheapest.finish, cheapest.usd_cents as price_cents,
           0 as owned, 0 as owned_real, 0 as other_decks, 0 as free
      from cheapest join printings p on p.id = cheapest.printing_id
  `);
  return rows.rows.map((row) => toCard(row, "store", context.format));
}

function toCard(row: CandidateRow, pool: "owned" | "store", format: Format): SuggestionCard {
  return {
    oracleId: row.oracle_id,
    printingId: row.printing_id,
    name: row.name,
    manaCost: row.mana_cost,
    manaValue: Number(row.mana_value),
    typeLine: row.type_line,
    owned: Number(row.owned),
    ownedReal: Number(row.owned_real),
    inThisDeck: 0,
    otherDecks: Number(row.other_decks),
    free: Number(row.free),
    misfit: null,
    rules: {
      name: row.name,
      typeLine: row.type_line,
      text: row.face_text,
      colorIdentity: row.color_identity.map((color) => ColorSchema.parse(color)),
      legalities: row.legality === null ? {} : { [format]: row.legality },
      isBasicLand: row.is_basic_land,
      hasPowerToughness: row.has_power_toughness,
    },
    producedMana: row.produced_mana ?? [],
    text: row.face_text,
    isGameChanger: row.is_game_changer,
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    finish: FinishSchema.parse(row.finish),
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    pool,
    keywords: row.keywords,
    roles: row.role_tags.filter((tag): tag is Tag => (TAGS as readonly string[]).includes(tag)),
    themes: row.theme_tags.filter((theme): theme is Theme =>
      (THEMES as readonly string[]).includes(theme),
    ),
    rarity: row.rarity,
  };
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
      return card === undefined ? [] : [{ card, reasons: scored.reasons }];
    });
}

function wantedFor(profile: DeckProfile): Wanted {
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
  profile: DeckProfile;
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
  if (nothingWanted(want)) return { profile, forDeck: EMPTY_LIST, forRoles: [] };

  const [owned, store] = await Promise.all([
    ownedCandidates(db, userId, context, want).then((cards) => withinTarget(cards, context)),
    storeCandidates(db, userId, context, want).then((cards) => withinTarget(cards, context)),
  ]);
  const over = [...owned.over, ...store.over];
  const forDeckScore = (card: CandidateCard) => scoreForDeck(card, profile);
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
             0 as owned, 0 as owned_real, 0 as other_decks, 0 as free
        from printings p join card_sets s on s.code = p.set_code
       where p.oracle_id = ${oracleId}
       order by ${STANDARD_FIRST} limit 1
    `)
  ).rows;
  if (targetRow === undefined) return EMPTY_LIST;
  const target = toCard(targetRow, "store", context.format);
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
export const BUDGET_LIST_MAXIMUM = 15;

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
  if (nothingWanted(want)) return { picks: [], totalCents: 0, listText: "", hiddenOverTarget: 0 };
  const split = withinTarget(await storeCandidates(db, userId, context, want), context);
  const store = split.kept;
  const byId = new Map(store.map((card) => [card.oracleId, card]));
  const scored = rank(store.map((card) => scoreForDeck(candidate(card), profile)));
  const picks = budgetPicks(scored, budgetCents, BUDGET_LIST_MAXIMUM).flatMap((pick) => {
    const card = byId.get(pick.card.oracleId);
    return card === undefined ? [] : [{ card, reasons: pick.reasons }];
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
    hiddenOverTarget: countScoring(split.over, (card) => scoreForDeck(card, profile)),
  };
}
