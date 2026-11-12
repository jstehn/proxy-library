import { sql } from "drizzle-orm";
import { z } from "zod";
import { parseList } from "@/shared/card-search";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { MAX_LIST_LINES, MAX_QUANTITY, type Board, type Format } from "../domain/deck";
import type { DeckChanged, DeckNotFound, ListProblems, ListTooLong } from "../domain/errors";
import { fingerprint } from "../domain/list-format";
import {
  previewChanges,
  type ChangePreview,
  type DeckChange,
  type PreviewLine,
} from "../domain/preview";
import type { CardRules } from "../domain/rules";
import { deckView, type DeckLine, type DeckView } from "./decks";
import { MOST_SPECIAL_FIRST, ownedCopies, STANDARD_FIRST } from "./owned";

// Read model for dry-run change previews (design doc 40, section 3.3). Shares `deckView` and the
// `owned.ts` SQL orderings so stats, legalities and prices agree with the deck builder.

const ColorSchema = z.enum(["W", "U", "B", "R", "G"]);

export type DeckChangePreview = ChangePreview &
  Readonly<{
    deck: Readonly<{ id: number; name: string; format: Format }>;
    fingerprint: string;
  }>;

export type ListPreviewError = DeckNotFound | DeckChanged | ListProblems | ListTooLong;

export type ListPreviewResult =
  | Readonly<{ ok: true; value: DeckChangePreview }>
  | Readonly<{ ok: false; error: ListPreviewError }>;

export function viewFingerprint(view: DeckView): string {
  return fingerprint(
    view.lines.map((line) => ({
      ...line,
      printingId: line.pinnedPrintingId,
      finish: line.pinnedFinish,
    })),
  );
}

export function lineToPreview(line: DeckLine, rules: CardRules): PreviewLine {
  return {
    oracleId: line.oracleId,
    name: line.name,
    board: line.board,
    quantity: line.quantity,
    manaValue: line.manaValue,
    typeLine: line.typeLine,
    manaCost: line.manaCost,
    producedMana: line.producedMana,
    priceCents: line.priceCents,
    text: line.text,
    isGameChanger: line.isGameChanger,
    owned: line.owned,
    rules,
  };
}

/** Loads card facts in the exact shape `deckView` reads for oracle cards not yet in the deck. */
export async function loadCardsForPreview(
  db: DbExecutor,
  userId: UserId,
  usesRealCards: boolean,
  oracleIds: readonly string[],
): Promise<Map<string, PreviewLine>> {
  const unique = [...new Set(oracleIds)];
  if (unique.length === 0) return new Map();
  const owned = ownedCopies(userId, sql`${usesRealCards}`);
  const rows = await db.execute<{
    oracle_id: string;
    name: string;
    type_line: string;
    mana_value: number;
    mana_cost: string | null;
    produced_mana: string[] | null;
    price_cents: number | null;
    is_basic_land: boolean;
    face_text: string;
    has_power_toughness: boolean;
    is_game_changer: boolean;
    color_identity: string[];
    legalities: Record<string, string> | null;
    owned: number;
  }>(sql`
    with wanted as (
      select unnest(${sql.param(unique)}::text[]) as oracle_id
    )
    select w.oracle_id,
           shown.name, shown.type_line, shown.mana_value, shown.mana_cost, shown.produced_mana,
           (select s.usd_cents from price_snapshots s
             where s.printing_id = shown.id
               and s.finish = coalesce(owned_finish.finish,
                    case when 'nonfoil' = any(shown.finishes) then 'nonfoil' else shown.finishes[1] end)
             order by s.day desc limit 1) as price_cents,
           newest.is_basic_land, newest.face_text, newest.has_power_toughness,
           exists (select 1 from printings g
                    where g.oracle_id = w.oracle_id and g.is_game_changer) as is_game_changer,
           newest.color_identity, newest.legalities,
           coalesce((select sum(c.quantity) from ${owned} c join printings p on p.id = c.printing_id
                      where p.oracle_id = w.oracle_id), 0)::int as owned
      from wanted w
      join lateral (
        select p.type_line ~ '^Basic\\y.*\\yLand\\y' as is_basic_land,
               coalesce((select string_agg(f->>'text', ' ') from jsonb_array_elements(p.faces) f), '') as face_text,
               exists (select 1 from jsonb_array_elements(p.faces) f
                        where f->>'power' is not null and f->>'toughness' is not null) as has_power_toughness,
               p.color_identity, p.legalities
          from printings p join card_sets s on s.code = p.set_code
         where p.oracle_id = w.oracle_id
         order by p.legalities is not null desc, s.release_date desc limit 1
      ) newest on true
      left join lateral (
        select c.printing_id, c.finish from ${owned} c join printings p on p.id = c.printing_id
         where p.oracle_id = w.oracle_id
         order by ${MOST_SPECIAL_FIRST} limit 1
      ) owned_printing on true
      join lateral (
        select p.* from printings p join card_sets s on s.code = p.set_code
         where p.id = owned_printing.printing_id
            or (owned_printing.printing_id is null and p.oracle_id = w.oracle_id)
         order by ${STANDARD_FIRST} limit 1
      ) shown on true
      left join lateral (
        select c.finish from ${owned} c join printings p on p.id = c.printing_id
         where c.printing_id = shown.id
         order by ${MOST_SPECIAL_FIRST} limit 1
      ) owned_finish on true
  `);

  const loaded = new Map<string, PreviewLine>();
  for (const row of rows.rows) {
    const colorIdentity = row.color_identity.map((color) => ColorSchema.parse(color));
    const rules: CardRules = {
      name: row.name,
      typeLine: row.type_line,
      text: row.face_text,
      colorIdentity,
      legalities: row.legalities ?? {},
      isBasicLand: row.is_basic_land,
      hasPowerToughness: row.has_power_toughness,
    };
    loaded.set(row.oracle_id, {
      oracleId: row.oracle_id,
      name: row.name,
      board: "main",
      quantity: 1,
      manaValue: Number(row.mana_value),
      typeLine: row.type_line,
      manaCost: row.mana_cost,
      producedMana: row.produced_mana ?? [],
      priceCents: row.price_cents === null ? null : Number(row.price_cents),
      text: row.face_text,
      isGameChanger: row.is_game_changer,
      owned: row.owned,
      rules,
    });
  }
  return loaded;
}

async function previewFromView(
  db: DbExecutor,
  userId: UserId,
  view: DeckView,
  currentFingerprint: string,
  changes: readonly DeckChange[],
): Promise<DeckChangePreview> {
  const before = view.lines.map((line) => lineToPreview(line, view.rules[line.oracleId]));
  const inDeck = new Set(before.map((line) => line.oracleId));
  const missingIds = changes
    .map((change) => change.oracleId)
    .filter((oracleId) => !inDeck.has(oracleId));
  const extra = await loadCardsForPreview(db, userId, view.deck.usesRealCards, missingIds);
  const preview = previewChanges({
    format: view.deck.format,
    targetBracket: view.deck.targetBracket,
    before,
    changes,
    facts: (oracleId) => {
      const found = extra.get(oracleId);
      if (found === undefined) throw new Error(`unknown card ${oracleId}`);
      return found;
    },
  });
  return {
    ...preview,
    deck: { id: Number(view.deck.id), name: view.deck.name, format: view.deck.format },
    fingerprint: currentFingerprint,
  };
}

/**
 * Dry-runs a batch of quantity changes against one of your decks, or returns null if the deck
 * doesn't exist or isn't yours.
 */
export async function deckChangePreview(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  changes: readonly DeckChange[],
): Promise<DeckChangePreview | null> {
  const view = await deckView(db, userId, deckId);
  if (view === null) return null;
  return previewFromView(db, userId, view, viewFingerprint(view), changes);
}

/**
 * Dry-runs an Edit-as-text list against one of your decks (design doc 40, section 6), reporting
 * parse/missing-card/stale-fingerprint errors the same way saving does.
 */
export async function deckListPreview(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  text: string,
  expectedFingerprint: string,
): Promise<ListPreviewResult> {
  if (text.split("\n").length > MAX_LIST_LINES) {
    return { ok: false, error: { kind: "ListTooLong", maximumLines: MAX_LIST_LINES } };
  }
  const view = await deckView(db, userId, deckId);
  if (view === null) return { ok: false, error: { kind: "DeckNotFound" } };
  const currentFingerprint = viewFingerprint(view);
  if (currentFingerprint !== expectedFingerprint) {
    return { ok: false, error: { kind: "DeckChanged" } };
  }

  const parsed = parseList(text, { keepMaybeboard: true });
  const knownByName = new Map<string, string>();
  for (const line of view.lines) {
    knownByName.set(line.name.toLowerCase(), line.oracleId);
    knownByName.set(line.name.split(" // ")[0].toLowerCase(), line.oracleId);
  }
  const missingNames = [
    ...new Set(
      parsed.lines.map((line) => line.name.toLowerCase()).filter((name) => !knownByName.has(name)),
    ),
  ];
  if (missingNames.length > 0) {
    const rows = await db.execute<{ oracle_id: string; name: string }>(sql`
      select p.oracle_id, p.name
        from printings p join card_sets s on s.code = p.set_code
       where lower(p.name) = any(${sql.param(missingNames)}::text[])
          or lower(split_part(p.name, ' // ', 1)) = any(${sql.param(missingNames)}::text[])
       order by ${STANDARD_FIRST}
    `);
    for (const row of rows.rows) {
      const full = row.name.toLowerCase();
      const front = row.name.split(" // ")[0].toLowerCase();
      if (!knownByName.has(full)) knownByName.set(full, row.oracle_id);
      if (!knownByName.has(front)) knownByName.set(front, row.oracle_id);
    }
  }

  const notFound: string[] = [];
  const target = new Map<string, { oracleId: string; board: Board; quantity: number }>();
  for (const line of parsed.lines) {
    const oracleId = knownByName.get(line.name.toLowerCase());
    if (oracleId === undefined) {
      notFound.push(line.name);
      continue;
    }
    const key = `${line.board}:${oracleId}`;
    const existing = target.get(key);
    target.set(key, {
      oracleId,
      board: line.board,
      quantity: Math.min(MAX_QUANTITY, (existing?.quantity ?? 0) + line.quantity),
    });
  }
  if (notFound.length > 0 || parsed.unreadable.length > 0) {
    return {
      ok: false,
      error: { kind: "ListProblems", unreadable: parsed.unreadable, notFound },
    };
  }

  const current = new Map<string, { oracleId: string; board: Board; quantity: number }>();
  for (const entry of view.deck.entries) {
    current.set(`${entry.board}:${entry.oracleId}`, {
      oracleId: entry.oracleId,
      board: entry.board,
      quantity: entry.quantity,
    });
  }
  const changes: DeckChange[] = [];
  for (const [key, entry] of current) {
    const next = target.get(key);
    if (next === undefined) {
      changes.push({ oracleId: entry.oracleId, board: entry.board, quantity: 0 });
    } else if (next.quantity !== entry.quantity) {
      changes.push(next);
    }
  }
  for (const [key, entry] of target) {
    if (!current.has(key)) changes.push(entry);
  }

  return { ok: true, value: await previewFromView(db, userId, view, currentFingerprint, changes) };
}
