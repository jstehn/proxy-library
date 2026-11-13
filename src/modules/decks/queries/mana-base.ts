import { sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { TAGS, THEMES, type Tag, type Theme } from "@/shared/card-search";
import { seededRng, type UserId } from "@/shared/kernel";
import { bracketLine, fitsTarget } from "../domain/brackets";
import { isCounted } from "../domain/boards";
import {
  simulateCastOnCurve,
  type CastabilityLine,
  type CastabilitySummary,
} from "../domain/castability";
import { planManaBase, type LandCandidate, type ManaBasePlan } from "../domain/mana-base";
import { deckStats, MANA_COLORS } from "../domain/stats";
import { deckProfile } from "../domain/suggest";
import { ownedCopies } from "./owned";
import { suggestionContext, type SuggestionContext } from "./suggestions";

// A mana base you could start from (design doc 35, section 9): SQL gathers the lands the deck may
// play (yours, the basics, and the store's), and the pure planManaBase picks among them.

/** How many store lands SQL hands to the plan. */
const STORE_LIMIT = 200;

const BASIC_NAMES = ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"];

type LandRow = {
  oracle_id: string;
  name: string;
  type_line: string;
  face_text: string;
  produced_mana: string[] | null;
  is_basic_land: boolean;
  is_game_changer: boolean;
  role_tags: string[];
  theme_tags: string[];
  owned: number;
  also_in: string[] | null;
  price_cents: number | null;
};

function textArray(values: readonly string[]): SQL {
  return sql`array[${sql.join(
    [...values, "_"].map((value) => sql`${value}`), // "_" keeps an empty array typed
    sql`, `,
  )}]::text[]`;
}

/** The columns a land row needs, from a printing `p`. */
const LAND_COLUMNS = sql`p.oracle_id, p.name, p.type_line,
  coalesce((select string_agg(f->>'text', ' ') from jsonb_array_elements(p.faces) f), '') as face_text,
  p.produced_mana, p.type_line ~ '^Basic\\y.*\\yLand\\y' as is_basic_land, p.is_game_changer,
  p.role_tags, p.theme_tags`;

/** A printing `p` whose front face is a land, isn't basic, and may be in this deck. */
function playableLand(format: string, colorLimit: readonly string[] | null): SQL {
  const identity =
    colorLimit === null ? sql`true` : sql`p.color_identity <@ ${textArray(colorLimit)}`;
  const legal =
    format === "casual"
      ? sql`true`
      : sql`coalesce(p.legalities->>${format}, 'legal') in ('legal', 'restricted')`;
  return sql`split_part(p.type_line, ' // ', 1) ~ '\\yLand\\y'
    and p.type_line !~ '^Basic\\y.*\\yLand\\y' and ${identity} and ${legal}`;
}

function toCandidate(row: LandRow): LandCandidate {
  return {
    oracleId: row.oracle_id,
    name: row.name,
    typeLine: row.type_line,
    text: row.face_text,
    producedMana: row.produced_mana ?? [],
    isBasicLand: row.is_basic_land,
    ownedCopies: Number(row.owned),
    alsoIn: row.also_in ?? [],
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    roles: row.role_tags.filter((tag): tag is Tag => (TAGS as readonly string[]).includes(tag)),
    themes: row.theme_tags.filter((theme): theme is Theme =>
      (THEMES as readonly string[]).includes(theme),
    ),
  };
}

export type LandPools = Readonly<{
  owned: LandCandidate[];
  basics: LandCandidate[];
  store: LandCandidate[];
}>;

/** Owned non-basic lands, basic lands, and candidate store lands for a deck context. */
export async function landPoolsForDeck(
  db: DbExecutor,
  userId: UserId,
  context: SuggestionContext,
  extraThemes: readonly Theme[] = [],
): Promise<LandPools> {
  const { deckId } = context;
  const playable = playableLand(context.format, context.colorLimit);

  // Every land you own: decks share cards, so other decks only show up as a note.
  const owned = await db.execute<LandRow>(sql`
    with owned as (
      select p.oracle_id, sum(c.quantity)::int as owned,
             (array_agg(c.printing_id order by c.quantity desc, c.printing_id))[1] as printing_id
        from ${ownedCopies(userId, sql`${context.usesRealCards}`)} c join printings p on p.id = c.printing_id
       group by p.oracle_id
    )
    select ${LAND_COLUMNS}, owned.owned, null::int as price_cents,
           (select array_agg(distinct d.name order by d.name) from deck_entries e
              join decks d on d.id = e.deck_id
             where d.owner_id = ${userId} and d.id <> ${deckId}
               and e.oracle_id = owned.oracle_id and e.board <> 'maybe') as also_in
      from owned join printings p on p.id = owned.printing_id
     where ${playable}
     order by p.name
  `);

  const basics = await db.execute<LandRow>(sql`
    select distinct on (p.name) ${LAND_COLUMNS}, 0 as owned, null::int as price_cents,
           null::text[] as also_in
      from printings p
     where p.name = any(${textArray(BASIC_NAMES)}) and p.type_line ~ '^Basic\\y.*\\yLand\\y'
     order by p.name, p.id
  `);

  // Store lands worth a look: two of the deck's colors (one, for a one-color deck), or a role
  // or theme the deck has. Each at its cheapest printing for sale.
  const stats = deckStats(context.lines);
  const cmdColors = (context.colorLimit ?? []).filter(
    (color): color is (typeof MANA_COLORS)[number] =>
      (MANA_COLORS as readonly string[]).includes(color),
  );
  const pipColors = MANA_COLORS.filter((color) => stats.pips[color] > 0);
  const deckColors = pipColors.length > 0 ? pipColors : cmdColors;
  const profile = deckProfile(context.lines, context.format);
  const deckRoles = profile.gaps.map((gap) => gap.tag);
  const themes = [...new Set([...profile.themes, ...extraThemes])];
  const colorsWanted = Math.min(2, Math.max(1, deckColors.length));
  const store = await db.execute<LandRow>(sql`
    with matching as (
      select distinct on (p.oracle_id) p.oracle_id
        from printings p join card_sets s on s.code = p.set_code and s.is_enabled
       where ${playable}
         and ((select count(*) from unnest(p.produced_mana) as made
                where made = any(${textArray(deckColors)})) >= ${colorsWanted}
              or p.role_tags && ${textArray(deckRoles)}
              or p.theme_tags && ${textArray(themes)})
         and not exists (select 1 from ${ownedCopies(userId, sql`${context.usesRealCards}`)} c
                           join printings op on op.id = c.printing_id
                          where op.oracle_id = p.oracle_id)
       order by p.oracle_id
       limit ${STORE_LIMIT}
    ),
    cheapest as (
      select matching.oracle_id, best.printing_id, best.usd_cents
        from matching
        join lateral (
          select p.id as printing_id, latest.usd_cents
            from printings p join card_sets s on s.code = p.set_code and s.is_enabled
            join lateral (select distinct on (ps.finish) ps.usd_cents
                            from price_snapshots ps where ps.printing_id = p.id
                           order by ps.finish, ps.day desc) latest on true
           where p.oracle_id = matching.oracle_id
           order by latest.usd_cents, p.id
           limit 1
        ) best on true
    )
    select ${LAND_COLUMNS}, 0 as owned, cheapest.usd_cents as price_cents, null::text[] as also_in
      from cheapest join printings p on p.id = cheapest.printing_id
  `);

  // Lands over the deck's target bracket (a Game Changer land) are never offered.
  const withinTarget = (row: LandRow) => {
    const target = context.targetBracket;
    if (target === null) return true;
    const { flags } = bracketLine({
      name: row.name,
      quantity: 1,
      board: "main",
      typeLine: row.type_line,
      text: row.face_text,
      isGameChanger: row.is_game_changer,
    });
    return fitsTarget(context.bracketLines, { name: row.name, flags }, target);
  };

  return {
    owned: owned.rows.filter(withinTarget).map(toCandidate),
    basics: basics.rows.map(toCandidate),
    store: store.rows.filter(withinTarget).map(toCandidate),
  };
}

export type ManaBasePlanWithCastability = ManaBasePlan &
  Readonly<{
    castability: Readonly<{
      before: CastabilitySummary;
      after: CastabilitySummary;
    }>;
  }>;

/** A mana base plan for one of this player's decks, or null if the deck isn't theirs. */
export async function manaBasePlan(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
): Promise<ManaBasePlanWithCastability | null> {
  const context = await suggestionContext(db, userId, deckId);
  if (context === null) return null;
  const pools = await landPoolsForDeck(db, userId, context);
  const profile = deckProfile(context.lines, context.format);

  const inDeck = new Map<string, number>();
  for (const line of context.lines) {
    if (!isCounted(line.board)) continue;
    inDeck.set(line.oracleId, (inDeck.get(line.oracleId) ?? 0) + line.quantity);
  }

  const plan = planManaBase({
    format: context.format,
    lines: context.lines,
    inDeck,
    owned: pools.owned,
    basics: pools.basics,
    store: pools.store,
    deckRoles: profile.gaps.map((gap) => gap.tag),
    deckThemes: profile.themes,
  });

  const beforeLines: CastabilityLine[] = context.lines.map((line) => ({
    oracleId: line.oracleId,
    name: line.oracleId,
    board: line.board,
    quantity: line.quantity,
    typeLine: line.typeLine,
    manaValue: line.manaValue,
    manaCost: line.manaCost ?? null,
    producedMana: line.producedMana ?? [],
    text: line.text ?? "",
  }));
  const afterLines: CastabilityLine[] = [
    ...beforeLines,
    ...plan.add.map((added) => ({
      oracleId: added.card.oracleId,
      name: added.card.name,
      board: "main" as const,
      quantity: added.quantity,
      typeLine: added.card.typeLine,
      manaValue: 0,
      manaCost: null,
      producedMana: added.card.producedMana,
      text: added.card.text,
    })),
  ];

  const before = simulateCastOnCurve(beforeLines, {
    rng: seededRng(`mana-base-${deckId}`),
    trials: 400,
  });
  const after = simulateCastOnCurve(afterLines, {
    rng: seededRng(`mana-base-${deckId}`),
    trials: 400,
  });

  return {
    ...plan,
    castability: { before, after },
  };
}
