import { sql, type SQL } from "drizzle-orm";
import { cheapestForSale, legalInFormat, notOwned, ownedPerCard } from "./candidate-pool";
import type { DbExecutor } from "@/shared/db";
import { latestPrice } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { type BracketFlag, type Tag, type Theme } from "@/shared/mtg";
import { parseSearch } from "@/shared/card-search";
import {
  foilOwnedBy,
  searchCondition,
  featureArray,
} from "@/modules/catalog/cards/queries/search-sql";
import { bracketLine, flagsOverTarget, type Bracket } from "@/modules/decks/core/client";
import type { Format } from "@/modules/decks/core/client";
import {
  SEARCH_FOR_DECK_LIMITS,
  searchForDeckResult,
  type FoundCard,
  type MergedCard,
  type QueryHits,
  type QueryReport,
  type SearchPool,
  type SynergyQuery,
  type SynergySort,
} from "../domain/search-for-deck";
import { deckBrowseContext } from "./browse";
import { deckView } from "@/modules/decks/core";

// Several synergy searches for one deck at once (design doc 28, section 3.3). Every query is
// ANDed with the deck's rules (rule 12): the commanders' color identity, the format's legality
// and "not already in this deck". Your cards come as your most special copy; the store's (cards
// you don't own) at their cheapest printing for sale.

export type SearchForDeckInput = Readonly<{
  deckId: number;
  queries: readonly SynergyQuery[];
  where: SearchPool;
  /** Cards per query, at most SEARCH_FOR_DECK_LIMITS.perQuery. */
  perQuery: number;
  /** Store cards above this price (cents) are left out. */
  maxPriceCents: number | null;
  sort?: SynergySort;
}>;

export type SearchForDeck = Readonly<{
  deck: Readonly<{
    id: number;
    name: string;
    format: Format;
    commanderColors: readonly string[] | null;
    /** The bracket the owner chose (design doc 31), or null. */
    targetBracket: Bracket | null;
  }>;
  /** What the searches left out to keep the deck within its target bracket. */
  leftOutOverTarget: readonly BracketFlag[];
  queries: readonly QueryReport[];
  cards: readonly MergedCard[];
}>;

type Context = NonNullable<Awaited<ReturnType<typeof deckBrowseContext>>> & {
  deckId: number;
  userId: UserId;
  /** Flags a card mustn't have, or it would take the deck over its target bracket. */
  overTarget: readonly BracketFlag[];
};

/** SQL: printing "p" has none of these bracket flags (invariant 10). */
function withinTarget(flags: readonly BracketFlag[]): SQL {
  const conditions: SQL[] = [];
  if (flags.includes("gameChanger")) conditions.push(sql`not p.is_game_changer`);
  const textFlags = flags.filter((flag) => flag !== "gameChanger");
  if (textFlags.length > 0) {
    const array = sql.join(
      textFlags.map((flag) => sql`${flag}`),
      sql`, `,
    );
    conditions.push(sql`not (${featureArray("bracket_flags")} && array[${array}]::text[])`);
  }
  return conditions.length === 0 ? sql`true` : sql.join(conditions, sql` and `);
}

/** The deck's rules for a printing "p" (rule 12). */
function fitsDeck(context: Context): SQL {
  const identity =
    context.commanderColors === null
      ? sql`true`
      : sql`p.color_identity <@ array[${sql.join(
          [...context.commanderColors, "_"].map((color) => sql`${color}`),
          sql`, `,
        )}]::text[]`;
  const legal = legalInFormat(context.format);
  const notInDeck = sql`not exists (select 1 from deck_entries e
                                     where e.deck_id = ${context.deckId} and e.oracle_id = p.oracle_id
                                       and e.board <> 'maybe')`;
  return sql`(${identity} and ${legal} and ${notInDeck} and ${withinTarget(context.overTarget)})`;
}

type Row = {
  oracle_id: string;
  printing_id: string;
  name: string;
  mana_cost: string | null;
  mana_value: number;
  type_line: string;
  face_text: string;
  role_tags: Tag[];
  theme_tags: Theme[];
  is_game_changer: boolean;
  owned: number;
  price_cents: number | null;
  last_acquired_at?: Date | string | null;
  total: number;
};

const CARD_COLUMNS = sql`p.oracle_id, p.id as printing_id, p.name, p.mana_cost, p.mana_value,
  p.type_line, ${featureArray("role_tags")} as role_tags, ${featureArray("theme_tags")} as theme_tags, p.is_game_changer,
  coalesce((select string_agg(f->>'text', ${"\n"}) from jsonb_array_elements(p.faces) f), '') as face_text`;

type CatalogQueriesPool = "owned" | "game" | "real" | "store" | "both";

type CatalogSynergySearchInput = Readonly<{
  queries: readonly SynergyQuery[];
  where: CatalogQueriesPool;
  /** Cards per query, at most SEARCH_FOR_DECK_LIMITS.perQuery. */
  perQuery: number;
  /** Store cards above this price (cents) are left out. */
  maxPriceCents: number | null;
  sort?: SynergySort;
}>;

export type CatalogSynergySearch = Readonly<{
  queries: readonly QueryReport[];
  cards: readonly MergedCard[];
}>;

type QueryScope = Readonly<{
  userId: UserId;
  usesRealCards: boolean;
  onlyRealCards: boolean;
  fits: SQL;
}>;

function ownedOrder(sort?: SynergySort): SQL {
  switch (sort) {
    case "mv":
      return sql`p.mana_value asc, p.name`;
    case "price_desc":
      return sql`price_cents desc nulls last, p.name`;
    case "added_desc":
      return sql`last_acquired_at desc nulls last, p.name`;
    default:
      return sql`p.name`;
  }
}

function storeOrder(sort?: SynergySort): SQL {
  switch (sort) {
    case "mv":
      return sql`p.mana_value asc, cheapest.usd_cents, p.name`;
    case "price_desc":
      return sql`cheapest.usd_cents desc, p.name`;
    case "name":
      return sql`p.name`;
    default:
      return sql`cheapest.usd_cents, p.name`;
  }
}

/** Your cards matching a search, as your most special copy of each. */
async function ownedHits(
  db: DbExecutor,
  scope: QueryScope,
  condition: SQL,
  limit: number,
  sort?: SynergySort,
): Promise<Row[]> {
  const realOnly = scope.onlyRealCards ? sql`owned.owned_real > 0` : sql`true`;
  const ownedCount = scope.onlyRealCards ? sql`owned.owned_real` : sql`owned.owned`;
  const lastAcquiredColumn =
    sort === "added_desc"
      ? sql`, greatest(
            (select max(a.created_at) from acquisitions a
              where a.user_id = ${scope.userId} and a.printing_id = p.id and a.quantity > 0),
            (select max(rc.added_at) from real_cards rc
              where rc.user_id = ${scope.userId} and rc.printing_id = p.id and ${scope.usesRealCards})
          ) as last_acquired_at`
      : sql``;
  const rows = await db.execute<Row>(sql`
    with owned as ${ownedPerCard(scope.userId, scope.usesRealCards)}
    select ${CARD_COLUMNS}, ${ownedCount} as owned,
           ${latestPrice("p.id", "owned.finish")} as price_cents
           ${lastAcquiredColumn},
           count(*) over ()::int as total
      from owned join printings p on p.id = owned.printing_id
     where ${condition} and ${scope.fits} and ${realOnly}
     order by ${ownedOrder(sort)}
     limit ${limit}
  `);
  return rows.rows;
}

/** Store cards matching a search that you don't own, each at its cheapest printing for sale. */
async function storeHits(
  db: DbExecutor,
  scope: QueryScope,
  condition: SQL,
  limit: number,
  maxPriceCents: number | null,
  sort?: SynergySort,
): Promise<Row[]> {
  const priceLimit =
    maxPriceCents === null ? sql`true` : sql`cheapest.usd_cents <= ${maxPriceCents}`;
  const rows = await db.execute<Row>(sql`
    with matching as (
      select distinct p.oracle_id
        from printings p join card_sets s on s.code = p.set_code and s.is_enabled
       where ${condition} and ${scope.fits}
         and ${notOwned(scope.userId, scope.usesRealCards)}
    ),
    cheapest as (
      select matching.oracle_id, best.printing_id, best.usd_cents
        from matching
        join lateral ${cheapestForSale(sql`matching.oracle_id`)} best on true
    )
    select ${CARD_COLUMNS}, 0 as owned, cheapest.usd_cents as price_cents,
           count(*) over ()::int as total
      from cheapest join printings p on p.id = cheapest.printing_id
     where ${priceLimit}
     order by ${storeOrder(sort)}
     limit ${limit}
  `);
  return rows.rows;
}

function toFound(row: Row): FoundCard {
  const lastAcquiredAt =
    row.last_acquired_at === undefined || row.last_acquired_at === null
      ? undefined
      : row.last_acquired_at instanceof Date
        ? row.last_acquired_at
        : new Date(row.last_acquired_at);
  return {
    oracleId: row.oracle_id,
    printingId: row.printing_id,
    name: row.name,
    manaCost: row.mana_cost,
    manaValue: Number(row.mana_value),
    typeLine: row.type_line,
    text: row.face_text,
    roleTags: row.role_tags,
    themes: row.theme_tags,
    isGameChanger: row.is_game_changer,
    owned: Number(row.owned),
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    ...(lastAcquiredAt !== undefined ? { lastAcquiredAt } : {}),
  };
}

type RunQueriesOptions = Readonly<{
  queries: readonly SynergyQuery[];
  includeOwned: boolean;
  includeStore: boolean;
  perQuery: number;
  maxPriceCents: number | null;
  sort?: SynergySort;
  deckId?: number;
}>;

async function runSynergyQueries(
  db: DbExecutor,
  scope: QueryScope,
  options: RunQueriesOptions,
): Promise<CatalogSynergySearch> {
  const perQuery = Math.min(Math.max(1, options.perQuery), SEARCH_FOR_DECK_LIMITS.perQuery);
  const queries = options.queries.slice(0, SEARCH_FOR_DECK_LIMITS.queries);

  // The queries run side by side; each is one or two SQL statements.
  const hits: QueryHits[] = await Promise.all(
    queries.map(async (query) => {
      const parsed = parseSearch(query.search);
      const condition = searchCondition(parsed.node, {
        userId: scope.userId,
        foil: foilOwnedBy(scope.userId, { includeReal: scope.usesRealCards }),
        ownIncludesReal: scope.usesRealCards,
        ...(options.deckId !== undefined ? { deckId: options.deckId } : {}),
      });
      const [owned, store] = await Promise.all([
        options.includeOwned ? ownedHits(db, scope, condition, perQuery, options.sort) : [],
        options.includeStore
          ? storeHits(db, scope, condition, perQuery, options.maxPriceCents, options.sort)
          : [],
      ]);
      const found = Number(owned[0]?.total ?? 0) + Number(store[0]?.total ?? 0);
      // Owned first, then the store, within one query's share of the cap.
      const cards = [...owned, ...store].slice(0, perQuery).map(toFound);
      return { query, found, cards, notes: parsed.notes };
    }),
  );

  return searchForDeckResult(hits, perQuery, options.sort);
}

/** Runs every query for one of your decks; null if the deck isn't yours. */
export async function searchForDeck(
  db: DbExecutor,
  userId: UserId,
  input: SearchForDeckInput,
): Promise<SearchForDeck | null> {
  const browse = await deckBrowseContext(db, userId, input.deckId);
  if (browse === null) return null;
  const view = await deckView(db, userId, input.deckId);
  if (view === null) return null;
  const target = view.deck.targetBracket;
  const overTarget = target === null ? [] : flagsOverTarget(view.lines.map(bracketLine), target);
  const context: Context = { ...browse, deckId: input.deckId, userId, overTarget };
  const scope: QueryScope = {
    userId,
    usesRealCards: context.usesRealCards,
    onlyRealCards: false,
    fits: fitsDeck(context),
  };
  const merged = await runSynergyQueries(db, scope, {
    queries: input.queries,
    includeOwned: input.where !== "store",
    includeStore: input.where !== "owned",
    perQuery: input.perQuery,
    maxPriceCents: input.maxPriceCents,
    sort: input.sort,
    deckId: input.deckId,
  });

  return {
    deck: {
      id: input.deckId,
      name: view.deck.name,
      format: context.format,
      commanderColors: context.commanderColors,
      targetBracket: target,
    },
    leftOutOverTarget: overTarget,
    ...merged,
  };
}

/** Runs batched synergy queries without a deck filter (design doc 71). */
export async function searchCatalogQueries(
  db: DbExecutor,
  userId: UserId,
  input: CatalogSynergySearchInput,
): Promise<CatalogSynergySearch> {
  const scope: QueryScope = {
    userId,
    usesRealCards: input.where !== "game",
    onlyRealCards: input.where === "real",
    fits: sql`true`,
  };
  return runSynergyQueries(db, scope, {
    queries: input.queries,
    includeOwned: input.where !== "store",
    includeStore: input.where === "store" || input.where === "both",
    perQuery: input.perQuery,
    maxPriceCents: input.maxPriceCents,
    sort: input.sort,
  });
}
