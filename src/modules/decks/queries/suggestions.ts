import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/shared/db";
import { TAGS, THEMES, type Tag, type Theme } from "@/shared/card-search";
import type { UserId } from "@/shared/kernel";
import { bracketLine, fitsTarget, type Bracket, type BracketLine } from "../domain/brackets";
import { isCounted, type Format } from "../domain/deck";
import { copyLimitFor } from "../domain/rules";
import type { RatingPart } from "../domain/rate";
import {
  budgetPicks,
  creatureTypes,
  deckProfile,
  rank,
  scoreForDeck,
  scoreForRole,
  scoreLike,
  toRatingProfile,
  type CandidateCard,
  type DeckProfile,
  type EdhrecSignal,
  type ProfileLine,
  type Scored,
} from "../domain/suggest";
import { rankBudgetReplacements } from "../domain/replacements";
import { isLand } from "../domain/stats";
import type { BrowseCard } from "./browse";
import { comboPartnersForDeck } from "./combos";
import { deckView } from "./decks";
import { embedSimForCards } from "./embeddings";
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
    edhrecRank?: number | null;
    edhrec?: EdhrecSignal | null;
    embedSim?: number | null;
  }>;

export type Suggestion = Readonly<{
  card: SuggestionCard;
  reasons: Scored["reasons"];
  rating: number;
  ratingParts: readonly RatingPart[];
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
export type SuggestionContext = Readonly<{
  deckId: number;
  format: Format;
  /** Whether real copies count as owned here (design doc 16). */
  usesRealCards: boolean;
  /** Colors a suggestion's identity must stay within, or null for any. */
  colorLimit: Array<z.infer<typeof ColorSchema>> | null;
  /** Oracle cards already at their format copy limit, not suggested again. */
  inDeck: string[];
  /** Counted quantity per oracle id currently in this deck (main + side + commander). */
  countedQuantities: ReadonlyMap<string, number>;
  /** The deck's lines, with their cards' oracle ids. */
  lines: Array<ProfileLine & Readonly<{ oracleId: string }>>;
  /** Oracle ids of the deck's commanders (Commander format only; empty otherwise). */
  commanderOracleIds: string[];
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

export function textArray(values: readonly string[]): SQL {
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
    const limit =
      copyLimitFor(view.deck.format, rule) ?? (view.deck.format === "commander" ? 1 : 4);
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
    commanderOracleIds:
      view.deck.format === "commander" ? commanders.map((line) => line.oracleId) : [],
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

/** The conditions every suggestion meets (invariant 2), on a printing `p`. */
export function fitsDeck(context: SuggestionContext): SQL {
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
export function tribePattern(tribes: readonly string[]): string | null {
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

export type CandidateRow = {
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
  edhrec_rank: number | null;
  edhrec_inclusion: number | null;
  edhrec_synergy: number | null;
  edhrec_total_decks: number | null;
};

function edhrecCte(commanderOracleIds: string[]): SQL {
  if (commanderOracleIds.length === 0) {
    return sql`select null::text as card_oracle_id, 0::real as inclusion_rate, 0::real as synergy, 0::int as total_decks where false`;
  }
  const ids = sql.join(
    commanderOracleIds.map((id) => sql`${id}`),
    sql`, `,
  );
  return sql`select ec.card_oracle_id,
                    max(ec.inclusion_rate)::real as inclusion_rate,
                    max(ec.synergy)::real as synergy,
                    max(e.total_decks)::int as total_decks
               from edhrec_commander_cards ec
               join edhrec_commanders e on e.commander_oracle_id = ec.commander_oracle_id
              where ec.commander_oracle_id in (${ids})
              group by ec.card_oracle_id`;
}

/** The columns a candidate row needs, from a printing `p` (its card) and a finish `finish`. */
export function candidateColumns(context: SuggestionContext): SQL {
  return sql`p.oracle_id, p.id as printing_id, p.name, p.mana_cost, p.mana_value, p.type_line,
    p.rarity, p.keywords, p.role_tags, p.theme_tags, p.color_identity,
    p.legalities->>${context.format} as legality,
    coalesce((select string_agg(f->>'text', ' ') from jsonb_array_elements(p.faces) f), '') as face_text,
    exists (select 1 from jsonb_array_elements(p.faces) f
             where f->>'power' is not null and f->>'toughness' is not null) as has_power_toughness,
    p.type_line ~ '^Basic\\y.*\\yLand\\y' as is_basic_land,
    p.produced_mana, p.is_game_changer, p.edhrec_rank, p.set_code, p.collector_number`;
}

function isComboPartnerSql(partnerIds: readonly string[], column: SQL = sql`p.oracle_id`): SQL {
  return partnerIds.length === 0 ? sql`false` : sql`${column} = any(${textArray(partnerIds)})`;
}

function isComboPartnerOrderSql(
  partnerIds: readonly string[],
  column: SQL = sql`p.oracle_id`,
): SQL {
  return partnerIds.length === 0 ? sql`` : sql`(${column} = any(${textArray(partnerIds)})) desc,`;
}

/** Cards you own that share something with what's wanted: one per oracle card. */
async function ownedCandidates(
  db: DbExecutor,
  userId: UserId,
  context: SuggestionContext,
  want: Wanted,
  comboPartnerIds: readonly string[] = [],
): Promise<SuggestionCard[]> {
  const rows = await db.execute<CandidateRow>(sql`
    with owned as (
      select p.oracle_id, sum(c.quantity)::int as owned,
             coalesce(sum(c.quantity) filter (where c.is_real), 0)::int as owned_real,
             (array_agg(c.printing_id order by c.quantity desc, c.printing_id))[1] as printing_id,
             (array_agg(c.finish order by c.quantity desc, c.printing_id))[1] as finish
        from ${ownedCopies(userId, sql`${context.usesRealCards}`)} c join printings p on p.id = c.printing_id
       group by p.oracle_id
    ),
    edhrec as (
      ${edhrecCte(context.commanderOracleIds)}
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
                                               and e.board <> 'maybe'), 0), 0)::int as free,
           edhrec.inclusion_rate as edhrec_inclusion,
           edhrec.synergy as edhrec_synergy,
           edhrec.total_decks as edhrec_total_decks
      from owned join printings p on p.id = owned.printing_id
      left join edhrec on edhrec.card_oracle_id = p.oracle_id
     where ${fitsDeck(context)}
       and (${sharedCount(want)} > 0 or edhrec.synergy >= 0.05 or edhrec.inclusion_rate >= 0.15 or ${isComboPartnerSql(comboPartnerIds)})
     order by ${isComboPartnerOrderSql(comboPartnerIds)} ${sharedCount(want)} desc,
              coalesce(edhrec.synergy, 0) desc, coalesce(edhrec.inclusion_rate, 0) desc, p.name
     limit ${CANDIDATE_LIMIT}
  `);
  return rows.rows
    .map((row) => toCard(row, "owned", context))
    .filter((card) => card.owned > card.inThisDeck);
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
  comboPartnerIds: readonly string[] = [],
): Promise<SuggestionCard[]> {
  const rows = await db.execute<CandidateRow>(sql`
    with edhrec as (
      ${edhrecCte(context.commanderOracleIds)}
    ),
    matching as (
      select distinct on (p.oracle_id) p.oracle_id, ${sharedCount(want)} as shared,
             coalesce(edhrec.synergy, 0) as edhrec_synergy,
             coalesce(edhrec.inclusion_rate, 0) as edhrec_inclusion,
             edhrec.total_decks as edhrec_total_decks,
             case p.rarity when 'mythic' then 3 when 'rare' then 2 when 'uncommon' then 1 else 0 end
               as rarity_rank
        from printings p join card_sets s on s.code = p.set_code and s.is_enabled
        left join edhrec on edhrec.card_oracle_id = p.oracle_id
       where ${fitsDeck(context)}
         and (${sharedCount(want)} > 0 or edhrec.synergy >= 0.05 or edhrec.inclusion_rate >= 0.15 or ${isComboPartnerSql(comboPartnerIds)})
         and not exists (select 1 from ${ownedCopies(userId, sql`${context.usesRealCards}`)} c
                           join printings op on op.id = c.printing_id
                          where op.oracle_id = p.oracle_id)
       order by p.oracle_id, rarity_rank desc
    ),
    kept as (
      select oracle_id, edhrec_inclusion, edhrec_synergy, edhrec_total_decks from matching
       order by ${isComboPartnerOrderSql(comboPartnerIds, sql`oracle_id`)} shared desc,
                edhrec_synergy desc, edhrec_inclusion desc, rarity_rank desc, oracle_id
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
           0 as owned, 0 as owned_real, 0 as other_decks, 0 as free,
           kept.edhrec_inclusion, kept.edhrec_synergy, kept.edhrec_total_decks
      from cheapest
      join kept on kept.oracle_id = cheapest.oracle_id
      join printings p on p.id = cheapest.printing_id
  `);
  return rows.rows.map((row) => toCard(row, "store", context));
}

export function toCard(
  row: CandidateRow,
  pool: "owned" | "store",
  context: SuggestionContext,
): SuggestionCard {
  const { format } = context;
  return {
    oracleId: row.oracle_id,
    printingId: row.printing_id,
    name: row.name,
    manaCost: row.mana_cost,
    manaValue: Number(row.mana_value),
    typeLine: row.type_line,
    owned: Number(row.owned),
    ownedReal: Number(row.owned_real),
    inThisDeck: context.countedQuantities.get(row.oracle_id) ?? 0,
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
    edhrecRank: row.edhrec_rank === null ? null : Number(row.edhrec_rank),
    ...(row.edhrec_inclusion !== null && row.edhrec_synergy !== null
      ? {
          edhrec: {
            inclusionRate: Number(row.edhrec_inclusion),
            synergy: Number(row.edhrec_synergy),
            ...(row.edhrec_total_decks !== null
              ? { totalDecks: Number(row.edhrec_total_decks) }
              : {}),
          },
        }
      : {}),
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
      if (card === undefined) return [];
      const rating =
        scored.rating?.rating ??
        Math.max(0, Math.min(100, Math.round(100 / (1 + Math.exp(-scored.score)))));
      return [{ card, reasons: scored.reasons, rating, ratingParts: scored.rating?.parts ?? [] }];
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
  const comboPartners =
    context.format === "commander"
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

export async function ownedCandidatesForIds(
  db: DbExecutor,
  userId: UserId,
  context: SuggestionContext,
  oracleIds: readonly string[],
  maxPriceCents?: number,
): Promise<SuggestionCard[]> {
  if (oracleIds.length === 0) return [];
  const priceFilter =
    maxPriceCents !== undefined
      ? sql`and ps.usd_cents is not null and ps.usd_cents <= ${maxPriceCents}`
      : sql``;
  const rows = await db.execute<CandidateRow>(sql`
    with owned as (
      select p.oracle_id, sum(c.quantity)::int as owned,
             coalesce(sum(c.quantity) filter (where c.is_real), 0)::int as owned_real,
             (array_agg(c.printing_id order by c.quantity desc, c.printing_id))[1] as printing_id,
             (array_agg(c.finish order by c.quantity desc, c.printing_id))[1] as finish
        from ${ownedCopies(userId, sql`${context.usesRealCards}`)} c
        join printings p on p.id = c.printing_id
       where p.oracle_id = any(${textArray(oracleIds)})
       group by p.oracle_id
    )
    select ${candidateColumns(context)}, owned.finish, owned.owned, owned.owned_real,
           ps.usd_cents as price_cents,
           (select count(distinct e.deck_id) from deck_entries e join decks d on d.id = e.deck_id
             where d.owner_id = ${userId} and d.id <> ${context.deckId}
               and e.oracle_id = owned.oracle_id and e.board <> 'maybe')::int as other_decks,
           greatest(owned.owned - coalesce((select sum(e.quantity) from deck_entries e
                                              join decks d on d.id = e.deck_id
                                             where d.owner_id = ${userId} and d.id <> ${context.deckId}
                                               and e.oracle_id = owned.oracle_id
                                               and e.board <> 'maybe'), 0), 0)::int as free,
           null as edhrec_inclusion, null as edhrec_synergy, null as edhrec_total_decks
      from owned
      join printings p on p.id = owned.printing_id
      left join lateral (
        select s.usd_cents from price_snapshots s
         where s.printing_id = p.id and s.finish = owned.finish
         order by s.day desc limit 1
      ) ps on true
     where ${fitsDeck(context)}
       ${priceFilter}
  `);
  return rows.rows
    .map((row) => toCard(row, "owned", context))
    .filter((card) => card.owned > card.inThisDeck);
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
        with cheapest as (
          select distinct on (p.oracle_id) p.id as printing_id, latest.finish, latest.usd_cents
            from printings p join card_sets s on s.code = p.set_code and s.is_enabled
            join lateral (select distinct on (ps.finish) ps.finish, ps.usd_cents
                            from price_snapshots ps where ps.printing_id = p.id
                           order by ps.finish, ps.day desc) latest on true
           where p.oracle_id = any(${textArray(neighborIds)})
             and ${fitsDeck(withoutTarget)}
             and not exists (select 1 from ${ownedCopies(userId, sql`${withoutTarget.usesRealCards}`)} c
                               join printings op on op.id = c.printing_id
                              where op.oracle_id = p.oracle_id)
           order by p.oracle_id, latest.usd_cents, p.id
        )
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

export type BudgetReplacementPick = Readonly<{
  card: SuggestionCard;
  similarityPct: number;
  rating: number;
  savedCents: number;
}>;

export type ExpensiveCardReplacements = Readonly<{
  target: Readonly<{
    oracleId: string;
    name: string;
    priceCents: number;
    typeLine: string;
  }>;
  owned: BudgetReplacementPick[];
  store: BudgetReplacementPick[];
}>;

export type BudgetReplacementsResult = Readonly<{
  cards: ExpensiveCardReplacements[];
  minPriceCents: number;
  maxPriceCents: number;
}>;

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
  const minPriceCents = options.minPriceCents ?? 500;
  const maxPriceCents = options.maxPriceCents ?? 200;
  const limitPerCard = options.limitPerCard ?? 5;
  const limitCards = options.limitCards ?? 5;

  const profile = deckProfile(context.lines, context.format);
  const rProfile = toRatingProfile(profile);

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
        left join lateral (
          select ps.usd_cents from price_snapshots ps
           where ps.printing_id = p.id
           order by ps.day desc, ps.usd_cents asc
           limit 1
        ) latest on true
       where p.oracle_id = any(${textArray(targetIds)})
       order by p.oracle_id, latest.usd_cents asc nulls last, p.id
    `)
  ).rows;

  const expensiveTargets = targetRows
    .filter((row) =>
      options.oracleId
        ? row.oracle_id === options.oracleId
        : row.price_cents !== null && Number(row.price_cents) >= minPriceCents,
    )
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
        with cheapest as (
          select distinct on (p.oracle_id) p.id as printing_id, latest.finish, latest.usd_cents
            from printings p join card_sets s on s.code = p.set_code and s.is_enabled
            join lateral (select distinct on (ps.finish) ps.finish, ps.usd_cents
                            from price_snapshots ps where ps.printing_id = p.id
                           order by ps.finish, ps.day desc) latest on true
           where p.oracle_id = any(${textArray(neighborIds)})
             and ${fitsDeck(context)}
             and latest.usd_cents <= ${effectiveMaxPrice}
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

    const ownedCards = withinTarget(rawOwnedCards, context).kept;
    const storeCards = withinTarget(
      storeRows.rows.map((row) => toCard(row, "store", context)),
      context,
    ).kept;

    const toReplacementPicks = (pool: SuggestionCard[]): BudgetReplacementPick[] => {
      const byId = new Map(pool.map((card) => [card.oracleId, card]));
      return rankBudgetReplacements(
        { priceCents: targetPriceCents },
        pool.map((card) => ({ card, similarity: simById.get(card.oracleId) ?? 0 })),
        rProfile,
        {
          targetBracket: context.targetBracket,
          maxPriceCents: effectiveMaxPrice,
          limit: limitPerCard,
        },
      ).flatMap((pick) => {
        const card = byId.get(pick.card.oracleId);
        if (!card) return [];
        return [
          {
            card,
            similarityPct: pick.similarityPct,
            rating: pick.rating.rating,
            savedCents: pick.savedCents,
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
