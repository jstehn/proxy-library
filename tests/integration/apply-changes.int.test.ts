// Dry-run changes and applyChanges (design doc 40) against real Postgres and the fixture catalog.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deckChangePreview, deckListPreview, deckView, makeDecks } from "@/modules/decks";
import { actor, clock, close, db, loadFixtureCatalog, resetPlayers, unitOfWork } from "./harness";

afterAll(close);

type TestCard = Readonly<{
  name: string;
  typeLine: string;
  identity: string[];
  manaCost?: string;
  manaValue?: number;
  text?: string;
  roles?: string[];
  isGameChanger?: boolean;
  priceCents?: number;
}>;

const textArray = (values: readonly string[]) =>
  sql`${`{${values.map((value) => `"${value}"`).join(",")}}`}::text[]`;

const oracleIds = new Map<string, string>();
let collectorNumber = 960;

async function addCard(card: TestCard): Promise<void> {
  const id = randomUUID();
  const oracleId = randomUUID();
  oracleIds.set(card.name, oracleId);
  collectorNumber += 1;
  const faces = [{ name: card.name, text: card.text ?? "", power: "2", toughness: "2" }];
  await db.execute(sql`
    insert into printings (id, set_code, collector_number, name, oracle_id, scryfall_id, rarity,
                           colors, color_identity, mana_cost, mana_value, type_line, layout,
                           finishes, border_color, frame_version, frame_effects, promo_types,
                           is_full_art, variant_label, faces, legalities, role_tags, is_game_changer)
    values (${id}, 'BLB', ${`${collectorNumber}`}, ${card.name}, ${oracleId}, ${randomUUID()},
            'rare', ${textArray(card.identity)}, ${textArray(card.identity)},
            ${card.manaCost ?? "{1}{G}"}, ${card.manaValue ?? 2}, ${card.typeLine}, 'normal',
            '{nonfoil}', 'black', '2015', '{}', '{}', false, '',
            ${JSON.stringify(faces)}::jsonb, '{"commander": "legal"}'::jsonb,
            ${textArray(card.roles ?? [])}, ${card.isGameChanger ?? false})`);
  if (card.priceCents !== undefined) {
    await db.execute(sql`
      insert into price_snapshots (printing_id, finish, day, usd_cents)
      values (${id}, 'nonfoil', '2026-11-01', ${card.priceCents})`);
  }
}

beforeAll(async () => {
  await loadFixtureCatalog();
  await addCard({
    name: "Test Preview Commander",
    typeLine: "Legendary Creature — Elf",
    identity: ["G"],
    manaCost: "{2}{G}",
    manaValue: 3,
    priceCents: 200,
  });
  await addCard({
    name: "Test Preview Ramp",
    typeLine: "Sorcery",
    identity: ["G"],
    text: "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
    roles: ["ramp"],
    priceCents: 75,
  });
  await addCard({
    name: "Test Preview Game Changer",
    typeLine: "Artifact",
    identity: ["G"],
    isGameChanger: true,
    priceCents: 300,
  });
});

beforeEach(() => resetPlayers(["jack"]));

const decks = makeDecks({ unitOfWork, clock });
const jack = actor("jack");

describe("dry-run preview & applyChanges (design doc 40)", () => {
  it("previews changes including cards not yet in the deck, saves once, and rejects a stale fingerprint", async () => {
    const created = await decks.createDeck(jack, { name: "Preview Deck", format: "commander" });
    if (!created.ok) throw new Error(created.error.kind);
    const deckId = created.value;
    await decks.updateDeck(jack, { deckId, targetBracket: 2 });

    const commanderId = oracleIds.get("Test Preview Commander")!;
    const rampId = oracleIds.get("Test Preview Ramp")!;
    const gcId = oracleIds.get("Test Preview Game Changer")!;

    await decks.setEntry(jack, { deckId, oracleId: commanderId, board: "commander", quantity: 1 });

    const preview = await deckChangePreview(db, jack.userId, deckId, [
      { oracleId: rampId, board: "main", quantity: 1 },
      { oracleId: gcId, board: "main", quantity: 1 },
    ]);
    expect(preview).not.toBeNull();
    expect(preview?.before.stats.cardCount).toBe(1);
    expect(preview?.after.stats.cardCount).toBe(3);
    expect(preview?.roles.find((role) => role.tag === "ramp")).toMatchObject({
      before: 0,
      after: 1,
      target: 10,
    });
    expect(preview?.bracket.warningAfter?.target).toBe(2);
    expect(preview?.priceDeltaCents).toBe(375);

    const saved = await decks.applyChanges(jack, {
      deckId,
      fingerprint: preview!.fingerprint,
      changes: [
        { oracleId: rampId, board: "main", quantity: 1 },
        { oracleId: gcId, board: "main", quantity: 1 },
      ],
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value.cards).toBe(3);
      expect(saved.value.fingerprint).not.toBe(preview!.fingerprint);
    }

    const view = await deckView(db, jack.userId, deckId);
    expect(view?.lines.map((line) => line.name).sort()).toEqual([
      "Test Preview Commander",
      "Test Preview Game Changer",
      "Test Preview Ramp",
    ]);

    const stale = await decks.applyChanges(jack, {
      deckId,
      fingerprint: preview!.fingerprint,
      changes: [{ oracleId: rampId, board: "main", quantity: 0 }],
    });
    expect(stale).toEqual({ ok: false, error: { kind: "DeckChanged" } });
  });

  it("previews an Edit-as-text list and reports unknown cards before previewing", async () => {
    const created = await decks.createDeck(jack, { name: "Text Preview", format: "commander" });
    if (!created.ok) throw new Error(created.error.kind);
    const deckId = created.value;
    const commanderId = oracleIds.get("Test Preview Commander")!;
    await decks.setEntry(jack, { deckId, oracleId: commanderId, board: "commander", quantity: 1 });

    const baseline = await deckChangePreview(db, jack.userId, deckId, []);
    const fp = baseline!.fingerprint;

    const bad = await deckListPreview(
      db,
      jack.userId,
      deckId,
      "Commander\n1 Test Preview Commander\nDeck\n1 Definitely Not A Real Card",
      fp,
    );
    expect(bad).toEqual({
      ok: false,
      error: {
        kind: "ListProblems",
        unreadable: [],
        notFound: ["Definitely Not A Real Card"],
      },
    });

    const good = await deckListPreview(
      db,
      jack.userId,
      deckId,
      "Commander\n1 Test Preview Commander\nDeck\n1 Test Preview Ramp",
      fp,
    );
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.value.before.stats.cardCount).toBe(1);
      expect(good.value.after.stats.cardCount).toBe(2);
      expect(good.value.changes).toEqual([
        {
          oracleId: oracleIds.get("Test Preview Ramp")!,
          name: "Test Preview Ramp",
          board: "main",
          beforeQuantity: 0,
          afterQuantity: 1,
        },
      ]);
    }
  });
});
