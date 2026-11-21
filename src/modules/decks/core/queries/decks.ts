import type { SignalIO } from "@/shared/kernel";
import { bracketFlagsOf, isBracket } from "../domain/brackets";
import type { BracketFlag } from "@/shared/kernel";
import { formatRules } from "../domain/format-rules";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { type DbExecutor, latestPrice } from "@/shared/db";
import { featureArray, signalIO } from "@/modules/catalog/cards/queries/search-sql";
import { ColorSchema, FinishSchema, type Tag, type Theme, UserId } from "@/shared/kernel";
import { BOARDS, DeckId, FORMATS, GROUPINGS, type Deck } from "../domain/deck";
import type { DeckLine, DeckView, OtherDeckUse } from "../domain/deck-view";
import type { CardRules } from "../domain/rules";
import type { EdhrecSignal } from "../domain/stats";
import { MOST_SPECIAL_FIRST, ownedCopies, STANDARD_FIRST } from "./owned";

// Read models for the deck screens (design doc 09, section 8). Ownership is counted by oracle
// card across every printing and finish (ADR 0011); basic lands never count as short (rule 1).

const OtherDeckUsesSchema = z.array(
  z.object({
    deckId: z.coerce.number(),
    name: z.string(),
    quantity: z.coerce.number(),
    available: z.coerce.number(),
  }),
);

/**
 * SQL: a JSON list of `OtherDeckUse`, or null: the player's decks other than `deckId` that hold
 * card `oracleId` (both are SQL, so a query can pass its own columns).
 */
function otherDeckUses(userId: UserId, deckId: SQL, oracleId: SQL): SQL {
  return sql`(select json_agg(json_build_object('deckId', other.id, 'name', other.name,
                                                'quantity', used.quantity, 'available', used.available)
                              order by other.name, other.id)
                from (select e2.deck_id, sum(e2.quantity)::int as quantity,
                             coalesce(sum(e2.quantity) filter (where e2.board <> 'commander'), 0)::int as available
                        from deck_entries e2
                       where e2.oracle_id = ${oracleId} and e2.deck_id <> ${deckId}
                         and e2.board <> 'maybe'
                       group by e2.deck_id) used
                join decks other on other.id = used.deck_id
               where other.owner_id = ${userId})`;
}

/** Your decks other than `deckId` that hold a card, and how many copies each (task 42). */
export async function otherDecksHolding(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  oracleId: string,
): Promise<OtherDeckUse[]> {
  const rows = await db.execute<{ uses: unknown }>(
    sql`select ${otherDeckUses(userId, sql`${deckId}`, sql`${oracleId}`)} as uses`,
  );
  return OtherDeckUsesSchema.parse(rows.rows[0]?.uses ?? []);
}

/** A player's deck, ready for the builder, or null if it isn't theirs. */
export async function deckView(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
): Promise<DeckView | null> {
  const [deckRow] = (
    await db.execute<{
      id: number;
      owner_id: string;
      name: string;
      format: string;
      uses_real_cards: boolean;
      target_bracket: number | null;
      grouping: string;
      heading_order: string[];
    }>(sql`
      select id, owner_id, name, format, uses_real_cards, target_bracket, grouping, heading_order
        from decks
       where id = ${deckId} and owner_id = ${userId}
    `)
  ).rows;
  if (deckRow === undefined) return null;
  const owned = ownedCopies(userId, sql`${deckRow.uses_real_cards}`);

  const rows = await db.execute<{
    oracle_id: string;
    board: string;
    quantity: number;
    pinned_printing: string | null;
    pinned_finish: string | null;
    heading: string | null;
    note: string | null;
    tags: string[] | null;
    role: string | null;
    pinned: boolean;
    printing_id: string;
    finish: string;
    name: string;
    type_line: string;
    mana_value: number;
    mana_cost: string | null;
    produced_mana: string[] | null;
    role_tags: Tag[];
    bracket_flags: BracketFlag[];
    signals: SignalIO;
    theme_tags: Theme[];
    leader_themes: Theme[];
    price_cents: number | null;
    set_code: string;
    collector_number: string;
    rarity: string;
    keywords: string[] | null;
    edhrec_rank: number | null;
    is_basic_land: boolean;
    face_text: string;
    face_texts: string[] | null;
    printed_stats: string | null;
    is_game_changer: boolean;
    has_power_toughness: boolean;
    color_identity: string[];
    legalities: Record<string, string> | null;
    owned: number;
    owned_real: number;
    other_decks: unknown;
  }>(sql`
    select e.oracle_id, e.board, e.quantity, e.printing_id as pinned_printing, e.finish as pinned_finish,
           e.heading, e.note, e.tags, e.role, e.pinned, shown.id as printing_id,
           coalesce(e.finish, owned_finish.finish,
                    case when 'nonfoil' = any(shown.finishes) then 'nonfoil' else shown.finishes[1] end) as finish,
           shown.name, shown.type_line, shown.mana_value, shown.mana_cost, shown.produced_mana,
           ${featureArray("role_tags", "shown")} as role_tags,
           ${featureArray("bracket_flags", "shown")} as bracket_flags,
           ${signalIO("shown")} as signals,
           ${featureArray("theme_tags", "shown")} as theme_tags,
           ${featureArray("leader_themes", "shown")} as leader_themes,
           ${latestPrice(
             "shown.id",
             `coalesce(e.finish, owned_finish.finish,
                    case when 'nonfoil' = any(shown.finishes) then 'nonfoil' else shown.finishes[1] end)`,
           )} as price_cents,
           shown.set_code, shown.collector_number, shown.rarity,
           shown.edhrec_rank,
           (select array_agg(distinct keyword) from printings kp cross join unnest(kp.keywords) as keyword
             where kp.oracle_id = e.oracle_id) as keywords,
           newest.is_basic_land, newest.face_text, newest.face_texts, newest.printed_stats,
           newest.has_power_toughness,
           exists (select 1 from printings g
                    where g.oracle_id = e.oracle_id and g.is_game_changer) as is_game_changer,
           newest.color_identity, newest.legalities,
           coalesce((select sum(c.quantity) from ${owned} c join printings p on p.id = c.printing_id
                      where p.oracle_id = e.oracle_id), 0)::int as owned,
           coalesce((select sum(c.quantity) from ${owned} c join printings p on p.id = c.printing_id
                      where c.is_real and p.oracle_id = e.oracle_id), 0)::int as owned_real,
           ${otherDeckUses(userId, sql`e.deck_id`, sql`e.oracle_id`)} as other_decks
      from deck_entries e
      -- The newest printing carries the current rules facts (legalities, identity).
      join lateral (
        select p.type_line ~ '^Basic\\y.*\\yLand\\y' as is_basic_land,
               coalesce((select string_agg(f->>'text', ' ') from jsonb_array_elements(p.faces) f), '') as face_text,
               (select array_agg(coalesce(face.f->>'text', '') order by face.position)
                  from jsonb_array_elements(p.faces) with ordinality as face(f, position)) as face_texts,
               (select case when face.f->>'power' is not null and face.f->>'toughness' is not null
                              then (face.f->>'power') || '/' || (face.f->>'toughness')
                            when face.f->>'loyalty' is not null then 'Loyalty ' || (face.f->>'loyalty')
                            when face.f->>'defense' is not null then 'Defense ' || (face.f->>'defense')
                       end
                  from jsonb_array_elements(p.faces) with ordinality as face(f, position)
                 order by face.position limit 1) as printed_stats,
               exists (select 1 from jsonb_array_elements(p.faces) f
                        where f->>'power' is not null and f->>'toughness' is not null) as has_power_toughness,
               p.color_identity, p.legalities
          from printings p join card_sets s on s.code = p.set_code
         where p.oracle_id = e.oracle_id
         order by p.legalities is not null desc, s.release_date desc limit 1
      ) newest on true
      -- Unpinned: show your most special copy of the card (design doc 23, section 14).
      left join lateral (
        select c.printing_id, c.finish from ${owned} c join printings p on p.id = c.printing_id
         where p.oracle_id = e.oracle_id
         order by ${MOST_SPECIAL_FIRST} limit 1
      ) owned_printing on true
      -- Else the card's standard printing (design doc 24, rule 2).
      join lateral (
        select p.* from printings p join card_sets s on s.code = p.set_code
         where p.id = coalesce(e.printing_id, owned_printing.printing_id)
            or (e.printing_id is null and owned_printing.printing_id is null and p.oracle_id = e.oracle_id)
         order by ${STANDARD_FIRST} limit 1
      ) shown on true
      -- The finish of the copy shown: your most special copy of that printing, so a pinned
      -- printing never borrows the finish of another one.
      left join lateral (
        select c.finish from ${owned} c join printings p on p.id = c.printing_id
         where c.printing_id = shown.id
         order by ${MOST_SPECIAL_FIRST} limit 1
      ) owned_finish on true
     where e.deck_id = ${deckId}
     order by shown.mana_value, shown.name
  `);

  const rules: Record<string, CardRules> = {};
  const lines: DeckLine[] = rows.rows.map((row) => {
    rules[row.oracle_id] = {
      name: row.name,
      typeLine: row.type_line,
      text: row.face_text,
      colorIdentity: row.color_identity.map((color) => ColorSchema.parse(color)),
      legalities: row.legalities ?? {},
      isBasicLand: row.is_basic_land,
      hasPowerToughness: row.has_power_toughness,
    };
    const otherDecks = OtherDeckUsesSchema.parse(row.other_decks ?? []);
    const usedElsewhere = otherDecks.reduce((total, use) => total + use.quantity, 0);
    return {
      oracleId: row.oracle_id,
      board: z.enum(BOARDS).parse(row.board),
      quantity: row.quantity,
      printingId: row.printing_id,
      finish: FinishSchema.parse(row.finish),
      pinnedPrintingId: row.pinned_printing,
      pinnedFinish: row.pinned_finish === null ? null : FinishSchema.parse(row.pinned_finish),
      heading: row.heading,
      note: row.note,
      tags: row.tags ?? [],
      role: row.role,
      pinned: row.pinned,
      name: row.name,
      typeLine: row.type_line,
      manaValue: Number(row.mana_value),
      manaCost: row.mana_cost,
      producedMana: row.produced_mana ?? [],
      roles: row.role_tags,
      themes: row.theme_tags,
      signals: row.signals,
      leaderThemes: row.leader_themes,
      text: row.face_text,
      faceTexts: row.face_texts ?? [],
      printedStats: row.printed_stats,
      isGameChanger: row.is_game_changer,
      bracketFlags: bracketFlagsOf(row.is_game_changer, row.bracket_flags),
      priceCents: row.price_cents === null ? null : Number(row.price_cents),
      setCode: row.set_code,
      collectorNumber: row.collector_number,
      rarity: row.rarity,
      keywords: row.keywords ?? [],
      edhrecRank: row.edhrec_rank === null ? null : Number(row.edhrec_rank),
      owned: row.owned,
      ownedReal: row.owned_real,
      isBasicLand: row.is_basic_land,
      otherDecks,
      free: Math.max(row.owned - usedElsewhere, 0),
    };
  });

  const deck: Deck = {
    id: DeckId.of(Number(deckRow.id)),
    ownerId: UserId.of(deckRow.owner_id),
    name: deckRow.name,
    format: z.enum(FORMATS).parse(deckRow.format),
    usesRealCards: deckRow.uses_real_cards,
    targetBracket:
      deckRow.target_bracket !== null && isBracket(deckRow.target_bracket)
        ? deckRow.target_bracket
        : null,
    grouping: z.enum(GROUPINGS).parse(deckRow.grouping),
    headings: deckRow.heading_order,
    entries: rows.rows.map((row) => ({
      oracleId: row.oracle_id,
      board: z.enum(BOARDS).parse(row.board),
      quantity: row.quantity,
      // Brands are made at the edges, not in read models: the stored printing and finish are on
      // each line as `pinnedPrintingId` and `pinnedFinish`.
      printingId: null,
      finish: null,
      heading: row.heading,
      note: row.note,
      tags: row.tags ?? [],
    })),
  };
  const commanderIds = formatRules(deck.format).hasCommandZone
    ? lines.filter((line) => line.board === "commander").map((line) => line.oracleId)
    : [];
  const edhrecByCard =
    commanderIds.length > 0 ? await loadEdhrecSignals(db, commanderIds) : new Map();
  const linesWithEdhrec =
    edhrecByCard.size === 0
      ? lines
      : lines.map((line) => {
          const signal = edhrecByCard.get(line.oracleId);
          return signal ? { ...line, edhrec: signal } : line;
        });

  return { deck, lines: linesWithEdhrec, rules };
}

export async function loadEdhrecSignals(
  db: DbExecutor,
  commanderOracleIds: readonly string[],
): Promise<Map<string, EdhrecSignal>> {
  const ids = sql.join(
    commanderOracleIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{
    card_oracle_id: string;
    inclusion_rate: number;
    synergy: number;
  }>(sql`
    select ec.card_oracle_id,
           max(ec.inclusion_rate)::real as inclusion_rate,
           max(ec.synergy)::real as synergy
      from edhrec_commander_cards ec
     where ec.commander_oracle_id in (${ids})
     group by ec.card_oracle_id
  `);
  const map = new Map<string, EdhrecSignal>();
  for (const row of rows.rows) {
    map.set(row.card_oracle_id, {
      inclusionRate: Number(row.inclusion_rate),
      synergy: Number(row.synergy),
    });
  }
  return map;
}
