import { sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import {
  parseSearch,
  TAGS,
  THEMES,
  type BracketFlag,
  type Tag,
  type Theme,
} from "@/shared/card-search";
import { foilOwnedBy, searchCondition } from "@/shared/card-search/sql";
import { bracketLine, flagsOverTarget, type Bracket } from "../domain/brackets";
import type { Format } from "../domain/deck";
import {
  SEARCH_FOR_DECK_LIMITS,
  searchForDeckResult,
  type FoundCard,
  type MergedCard,
  type QueryHits,
  type QueryReport,
  type SearchPool,
  type SynergyQuery,
} from "../domain/search-for-deck";
import { deckBrowseContext } from "./browse";
import { deckView } from "./decks";
import { MOST_SPECIAL_FIRST, ownedCopies } from "./owned";

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
    conditions.push(sql`not (p.bracket_flags && array[${array}]::text[])`);
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
  const legal =
    context.format === "casual"
      ? sql`true`
      : sql`coalesce(p.legalities->>${context.format}, 'legal') in ('legal', 'restricted')`;
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
  role_tags: string[];
  theme_tags: string[];
  is_game_changer: boolean;
  owned: number;
  price_cents: number | null;
  total: number;
};

const CARD_COLUMNS = sql`p.oracle_id, p.id as printing_id, p.name, p.mana_cost, p.mana_value,
  p.type_line, p.role_tags, p.theme_tags, p.is_game_changer,
  coalesce((select string_agg(f->>'text', ${"\n"}) from jsonb_array_elements(p.faces) f), '') as face_text`;

/** Your cards matching a search, as your most special copy of each. */
async function ownedHits(
  db: DbExecutor,
  context: Context,
  condition: SQL,
  limit: number,
): Promise<Row[]> {
  const owned = ownedCopies(context.userId, sql`${context.usesRealCards}`);
  const rows = await db.execute<Row>(sql`
    with owned as (
      select p.oracle_id, sum(c.quantity)::int as owned,
             (array_agg(c.printing_id order by ${MOST_SPECIAL_FIRST}))[1] as printing_id,
             (array_agg(c.finish order by ${MOST_SPECIAL_FIRST}))[1] as finish
        from ${owned} c join printings p on p.id = c.printing_id
       group by p.oracle_id
    )
    select ${CARD_COLUMNS}, owned.owned,
           (select s.usd_cents from price_snapshots s
             where s.printing_id = p.id and s.finish = owned.finish
             order by s.day desc limit 1) as price_cents,
           count(*) over ()::int as total
      from owned join printings p on p.id = owned.printing_id
     where ${condition} and ${fitsDeck(context)}
     order by p.name
     limit ${limit}
  `);
  return rows.rows;
}

/** Store cards matching a search that you don't own, each at its cheapest printing for sale. */
async function storeHits(
  db: DbExecutor,
  context: Context,
  condition: SQL,
  limit: number,
  maxPriceCents: number | null,
): Promise<Row[]> {
  const owned = ownedCopies(context.userId, sql`${context.usesRealCards}`);
  const priceLimit =
    maxPriceCents === null ? sql`true` : sql`cheapest.usd_cents <= ${maxPriceCents}`;
  const rows = await db.execute<Row>(sql`
    with matching as (
      select distinct p.oracle_id
        from printings p join card_sets s on s.code = p.set_code and s.is_enabled
       where ${condition} and ${fitsDeck(context)}
         and not exists (select 1 from ${owned} c join printings op on op.id = c.printing_id
                          where op.oracle_id = p.oracle_id)
    ),
    cheapest as (
      select matching.oracle_id, best.printing_id, best.usd_cents
        from matching
        join lateral (
          select p.id as printing_id, latest.usd_cents
            from printings p join card_sets s on s.code = p.set_code and s.is_enabled
            join lateral (select distinct on (ps.finish) ps.finish, ps.usd_cents
                            from price_snapshots ps where ps.printing_id = p.id
                           order by ps.finish, ps.day desc) latest on true
           where p.oracle_id = matching.oracle_id
           order by latest.usd_cents, p.id
           limit 1
        ) best on true
    )
    select ${CARD_COLUMNS}, 0 as owned, cheapest.usd_cents as price_cents,
           count(*) over ()::int as total
      from cheapest join printings p on p.id = cheapest.printing_id
     where ${priceLimit}
     order by cheapest.usd_cents, p.name
     limit ${limit}
  `);
  return rows.rows;
}

function toFound(row: Row): FoundCard {
  return {
    oracleId: row.oracle_id,
    printingId: row.printing_id,
    name: row.name,
    manaCost: row.mana_cost,
    manaValue: Number(row.mana_value),
    typeLine: row.type_line,
    text: row.face_text,
    roleTags: row.role_tags.filter((tag): tag is Tag => (TAGS as readonly string[]).includes(tag)),
    themes: row.theme_tags.filter((theme): theme is Theme =>
      (THEMES as readonly string[]).includes(theme),
    ),
    isGameChanger: row.is_game_changer,
    owned: Number(row.owned),
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
  };
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
  const perQuery = Math.min(Math.max(1, input.perQuery), SEARCH_FOR_DECK_LIMITS.perQuery);
  const queries = input.queries.slice(0, SEARCH_FOR_DECK_LIMITS.queries);

  // The queries run side by side; each is one or two SQL statements.
  const hits: QueryHits[] = await Promise.all(
    queries.map(async (query) => {
      const parsed = parseSearch(query.search);
      const condition = searchCondition(parsed.node, {
        userId,
        foil: foilOwnedBy(userId, { includeReal: context.usesRealCards }),
        ownIncludesReal: context.usesRealCards,
        deckId: input.deckId,
      });
      const [owned, store] = await Promise.all([
        input.where === "store" ? [] : ownedHits(db, context, condition, perQuery),
        input.where === "owned"
          ? []
          : storeHits(db, context, condition, perQuery, input.maxPriceCents),
      ]);
      const found = Number(owned[0]?.total ?? 0) + Number(store[0]?.total ?? 0);
      // Owned first, then the store, within one query's share of the cap.
      const cards = [...owned, ...store].slice(0, perQuery).map(toFound);
      return { query, found, cards, notes: parsed.notes };
    }),
  );

  return {
    deck: {
      id: input.deckId,
      name: view.deck.name,
      format: context.format,
      commanderColors: context.commanderColors,
      targetBracket: target,
    },
    leftOutOverTarget: overTarget,
    ...searchForDeckResult(hits, perQuery),
  };
}
