import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { TAGS, THEMES, type Tag, type Theme } from "@/shared/card-search";
import type { UserId } from "@/shared/kernel";
import { bracketLine, fitsTarget } from "../domain/brackets";
import { isCounted } from "../domain/boards";
import {
  draftDeck,
  type DeckDraft,
  type DraftCandidate,
  type DraftOptions,
} from "../domain/draft-deck";
import { TARGETED_TAGS } from "../domain/stats";
import { deckProfile } from "../domain/suggest";
import { landPoolsForDeck } from "./mana-base";
import { ownedCopies } from "./owned";
import { fitsDeck, suggestionContext, textArray, tribePattern } from "./suggestions";

// Draft a deck (100-card Commander or 60-card Constructed with playsets) from owned cards first
// (design docs 37 & 44): SQL gathers your legal non-land cards, store non-land candidates, and the
// mana-base land pools, and the pure draftDeck assembles the deck.

const OWNED_SPELL_LIMIT = 1000;
const STORE_SPELL_LIMIT = 500;

const NON_LAND = sql`split_part(p.type_line, ' // ', 1) !~ '\\yLand\\y'`;

function spellColumns(format: string) {
  return sql`p.oracle_id, p.name, p.mana_cost, p.mana_value, p.type_line,
    p.rarity, p.keywords, p.role_tags, p.theme_tags, p.produced_mana, p.is_game_changer,
    coalesce((p.legalities->>${format}) = 'restricted', false) as is_restricted,
    coalesce((select string_agg(f->>'text', ' ') from jsonb_array_elements(p.faces) f), '') as face_text`;
}

type SpellRow = {
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  mana_value: number;
  type_line: string;
  rarity: string;
  keywords: string[];
  role_tags: string[];
  theme_tags: string[];
  produced_mana: string[] | null;
  is_game_changer: boolean;
  is_restricted: boolean;
  face_text: string;
  owned: number;
  price_cents: number | null;
  also_in: string[] | null;
};

function toCandidate(row: SpellRow, pool: "owned" | "store"): DraftCandidate {
  return {
    oracleId: row.oracle_id,
    name: row.name,
    manaCost: row.mana_cost,
    manaValue: Number(row.mana_value),
    typeLine: row.type_line,
    text: row.face_text,
    producedMana: row.produced_mana ?? [],
    keywords: row.keywords,
    roles: row.role_tags.filter((tag): tag is Tag => (TAGS as readonly string[]).includes(tag)),
    themes: row.theme_tags.filter((theme): theme is Theme =>
      (THEMES as readonly string[]).includes(theme),
    ),
    rarity: row.rarity,
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    pool,
    ownedCopies: Number(row.owned),
    alsoIn: row.also_in ?? [],
    isRestricted: row.is_restricted,
  };
}

/**
 * Draft a full deck list (100-card Commander or 60-card Constructed with playsets) for one of
 * this player's decks, or null if the deck isn't theirs, is Limited, or is Commander without a
 * commander yet.
 */
export async function draftForDeck(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  options: DraftOptions = {},
): Promise<DeckDraft | null> {
  const context = await suggestionContext(db, userId, deckId);
  if (context === null) return null;
  if (context.format === "limited") return null;
  if (context.format === "commander" && !context.lines.some((line) => line.board === "commander")) {
    return null;
  }

  const profile = deckProfile(context.lines, context.format);
  const wantedThemes = [...new Set([...profile.themes, ...(options.themes ?? [])])];
  const wantedRoles = TARGETED_TAGS;
  const tribes = tribePattern(profile.tribes);

  const ownedRowsPromise = db.execute<SpellRow>(sql`
    with owned as (
      select p.oracle_id, sum(c.quantity)::int as owned,
             (array_agg(c.printing_id order by c.quantity desc, c.printing_id))[1] as printing_id,
             (array_agg(c.finish order by c.quantity desc, c.printing_id))[1] as finish
        from ${ownedCopies(userId, sql`${context.usesRealCards}`)} c join printings p on p.id = c.printing_id
       group by p.oracle_id
    )
    select ${spellColumns(context.format)}, owned.owned,
           (select s.usd_cents from price_snapshots s
             where s.printing_id = p.id and s.finish = owned.finish
             order by s.day desc limit 1) as price_cents,
           (select array_agg(distinct d.name order by d.name) from deck_entries e
              join decks d on d.id = e.deck_id
             where d.owner_id = ${userId} and d.id <> ${deckId}
               and e.oracle_id = owned.oracle_id and e.board <> 'maybe') as also_in
      from owned join printings p on p.id = owned.printing_id
     where ${fitsDeck(context)} and ${NON_LAND}
     order by p.name
     limit ${OWNED_SPELL_LIMIT}
  `);

  const storeRowsPromise =
    options.includeStore === "none"
      ? Promise.resolve({ rows: [] as SpellRow[] })
      : db.execute<SpellRow>(sql`
          with matching as (
            select distinct on (p.oracle_id) p.oracle_id,
                   ((p.role_tags && ${textArray(wantedRoles)})::int
                    + (p.theme_tags && ${textArray(wantedThemes)})::int
                    + (p.keywords && ${textArray(profile.keywords)})::int
                    + ${
                      tribes === null
                        ? sql`0`
                        : sql`(split_part(p.type_line, ' // ', 1) ~ ${tribes} or 'Changeling' = any(p.keywords))::int`
                    }) as shared,
                   case p.rarity when 'mythic' then 3 when 'rare' then 2 when 'uncommon' then 1 else 0 end
                     as rarity_rank
              from printings p join card_sets s on s.code = p.set_code and s.is_enabled
             where ${fitsDeck(context)} and ${NON_LAND}
               and not exists (select 1 from ${ownedCopies(userId, sql`${context.usesRealCards}`)} c
                                 join printings op on op.id = c.printing_id
                                where op.oracle_id = p.oracle_id)
             order by p.oracle_id, rarity_rank desc
          ),
          kept as (
            select oracle_id from matching
             order by shared desc, rarity_rank desc, oracle_id
             limit ${STORE_SPELL_LIMIT}
          ),
          cheapest as (
            select kept.oracle_id, best.printing_id, best.usd_cents
              from kept
              join lateral (
                select p.id as printing_id, latest.usd_cents
                  from printings p join card_sets s on s.code = p.set_code and s.is_enabled
                  join lateral (select distinct on (ps.finish) ps.usd_cents
                                  from price_snapshots ps where ps.printing_id = p.id
                                 order by ps.finish, ps.day desc) latest on true
                 where p.oracle_id = kept.oracle_id
                 order by latest.usd_cents, p.id
                 limit 1
              ) best on true
          )
          select ${spellColumns(context.format)}, 0 as owned, cheapest.usd_cents as price_cents, null::text[] as also_in
            from cheapest join printings p on p.id = cheapest.printing_id
        `);

  const [ownedRows, storeRows, landPools] = await Promise.all([
    ownedRowsPromise,
    storeRowsPromise,
    landPoolsForDeck(db, userId, context, options.themes ?? []),
  ]);

  const withinTarget = (row: SpellRow): boolean => {
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

  const candidates: DraftCandidate[] = [
    ...ownedRows.rows.filter(withinTarget).map((row) => toCandidate(row, "owned")),
    ...storeRows.rows.filter(withinTarget).map((row) => toCandidate(row, "store")),
  ];

  const inDeck = new Map<string, number>();
  for (const line of context.lines) {
    if (!isCounted(line.board)) continue;
    inDeck.set(line.oracleId, (inDeck.get(line.oracleId) ?? 0) + line.quantity);
  }

  return draftDeck({
    format: context.format,
    lines: context.lines,
    inDeck,
    candidates,
    ownedLands: landPools.owned,
    basics: landPools.basics,
    storeLands: landPools.store,
    options,
  });
}
