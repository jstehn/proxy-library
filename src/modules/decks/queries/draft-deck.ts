import type { SignalIO } from "@/shared/kernel";
import { bracketFlagsOf, fitsTarget } from "../domain/brackets";
import type { BracketFlag } from "@/shared/kernel";
import { featureArray, signalIO } from "@/shared/card-search/sql";
import { formatRules } from "../domain/format-rules";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { latestPrice, textArray } from "@/shared/db";
import { type Tag, type Theme } from "@/shared/kernel";
import type { UserId } from "@/shared/kernel";
import { isCounted } from "../domain/boards";
import {
  draftDeck,
  type DeckDraft,
  type DraftCandidate,
  type DraftOptions,
} from "../domain/draft-deck";
import { TARGETED_TAGS } from "../domain/stats";
import { deckProfile } from "@/modules/decks/scoring/client";
import { landPoolsForDeck } from "./mana-base";
import { cheapestForSale, notOwned, ownedPerCard } from "./candidate-pool";
import { fitsDeck, tribePattern } from "./suggestion-sql";
import { suggestionContext } from "./suggestions";

// Draft a deck (100-card Commander or 60-card Constructed with playsets) from owned cards first
// (design docs 37 & 44): SQL gathers your legal non-land cards, store non-land candidates, and the
// mana-base land pools, and the pure draftDeck assembles the deck.

const OWNED_SPELL_LIMIT = 1000;
const STORE_SPELL_LIMIT = 500;

const NON_LAND = sql`split_part(p.type_line, ' // ', 1) !~ '\\yLand\\y'`;

function spellColumns(format: string) {
  return sql`p.oracle_id, p.name, p.mana_cost, p.mana_value, p.type_line,
    p.rarity, p.keywords, ${featureArray("role_tags")} as role_tags, ${featureArray("theme_tags")} as theme_tags,
    ${featureArray("bracket_flags")} as bracket_flags, ${signalIO()} as signals, p.produced_mana, p.is_game_changer,
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
  role_tags: Tag[];
  bracket_flags: BracketFlag[];
  signals: SignalIO;
  theme_tags: Theme[];
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
    roles: row.role_tags,
    themes: row.theme_tags,
    signals: row.signals,
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
  const rules = formatRules(context.format);
  if (!rules.canDraftDeck) return null;
  if (rules.hasCommandZone && !context.lines.some((line) => line.board === "commander")) {
    return null;
  }

  const profile = deckProfile(context.lines, context.format);
  const wantedThemes = [...new Set([...profile.themes, ...(options.themes ?? [])])];
  const wantedRoles = TARGETED_TAGS;
  const tribes = tribePattern(profile.tribes);

  const ownedRowsPromise = db.execute<SpellRow>(sql`
    with owned as ${ownedPerCard(userId, context.usesRealCards)}
    select ${spellColumns(context.format)}, owned.owned,
           ${latestPrice("p.id", "owned.finish")} as price_cents,
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
                   ((${featureArray("role_tags")} && ${textArray(wantedRoles)})::int
                    + (${featureArray("theme_tags")} && ${textArray(wantedThemes)})::int
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
               and ${notOwned(userId, context.usesRealCards)}
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
              join lateral ${cheapestForSale(sql`kept.oracle_id`)} best on true
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
    const flags = bracketFlagsOf(row.is_game_changer, row.bracket_flags);
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
