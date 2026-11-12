// Draft a 100-card Commander deck from owned cards first (design doc 37, section 9) against real
// Postgres and the fixture catalog.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deckView, draftForDeck, makeDecks, type DeckId } from "@/modules/decks";
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
  themes?: string[];
  isGameChanger?: boolean;
  priceCents?: number;
}>;

const textArray = (values: readonly string[]) =>
  sql`${`{${values.map((value) => `"${value}"`).join(",")}}`}::text[]`;

let collectorNumber = 940;

async function addCard(card: TestCard): Promise<void> {
  const id = randomUUID();
  const oracleId = randomUUID();
  collectorNumber += 1;
  const faces = [{ name: card.name, text: card.text ?? "", power: "2", toughness: "2" }];
  await db.execute(sql`
    insert into printings (id, set_code, collector_number, name, oracle_id, scryfall_id, rarity,
                           colors, color_identity, mana_cost, mana_value, type_line, layout,
                           finishes, border_color, frame_version, frame_effects, promo_types,
                           is_full_art, variant_label, faces, legalities, role_tags, theme_tags,
                           is_game_changer)
    values (${id}, 'BLB', ${`${collectorNumber}`}, ${card.name}, ${oracleId}, ${randomUUID()},
            'uncommon', ${textArray(card.identity)}, ${textArray(card.identity)},
            ${card.manaCost ?? "{1}{W}"}, ${card.manaValue ?? 2}, ${card.typeLine}, 'normal',
            '{nonfoil}', 'black', '2015', '{}', '{}', false, '',
            ${JSON.stringify(faces)}::jsonb, '{"commander": "legal"}'::jsonb,
            ${textArray(card.roles ?? [])}, ${textArray(card.themes ?? [])},
            ${card.isGameChanger ?? false})`);
  if (card.priceCents !== undefined) {
    await db.execute(sql`
      insert into price_snapshots (printing_id, finish, day, usd_cents)
      values (${id}, 'nonfoil', '2026-11-01', ${card.priceCents})`);
  }
}

beforeAll(async () => {
  await loadFixtureCatalog();
  await addCard({
    name: "Test Draft Ramp",
    typeLine: "Artifact",
    identity: ["W"],
    roles: ["ramp"],
    priceCents: 60,
  });
  await addCard({
    name: "Test Draft Store Wipe",
    typeLine: "Sorcery",
    identity: ["W"],
    manaCost: "{2}{W}{W}",
    manaValue: 4,
    roles: ["wipe"],
    priceCents: 110,
  });
  await addCard({
    name: "Test Draft Game Changer",
    typeLine: "Enchantment",
    identity: ["W"],
    themes: ["tokens"],
    isGameChanger: true,
    priceCents: 500,
  });
});

beforeEach(() => resetPlayers(["jack", "sam"]));

const decks = makeDecks({ unitOfWork, clock });
const jack = actor("jack");

async function give(name: string, quantity = 1): Promise<void> {
  await db.execute(sql`
    insert into collection_cards (user_id, printing_id, finish, quantity)
    select ${jack.userId}, p.id, 'nonfoil', ${quantity} from printings p
     where p.name = ${name} order by p.collector_number limit 1
  `);
}

async function bezaDeck(): Promise<DeckId> {
  const created = await decks.createDeck(jack, { name: "Beza Draft", format: "commander" });
  if (!created.ok) throw new Error(created.error.kind);
  await decks.importList(jack, {
    deckId: created.value,
    text: "Commander\n1 Beza, the Bounding Spring",
  });
  return created.value;
}

describe("draftForDeck", () => {
  it("drafts owned cards first (even when used in another deck), fills gaps from store, and reaches 100 cards", async () => {
    await give("Banishing Light");
    await give("Carrot Cake");
    await give("Test Draft Ramp");
    await give("Agate Assault"); // red: outside Beza's white identity

    const other = await decks.createDeck(jack, { name: "Other Deck", format: "commander" });
    if (!other.ok) throw new Error(other.error.kind);
    await decks.importList(jack, {
      deckId: other.value,
      text: "Commander\n1 Beza, the Bounding Spring\nDeck\n1 Carrot Cake",
    });

    const deckId = await bezaDeck();
    const draft = await draftForDeck(db, jack.userId, deckId);
    if (draft === null) throw new Error("expected draft");

    expect(draft.existingCount).toBe(1);
    const ownedNames = draft.spells
      .filter((spell) => spell.pool === "owned")
      .map((spell) => spell.name);
    expect(ownedNames).toEqual(
      expect.arrayContaining(["Banishing Light", "Carrot Cake", "Test Draft Ramp"]),
    );
    expect(ownedNames).not.toContain("Agate Assault");

    const carrotCake = draft.spells.find((spell) => spell.name === "Carrot Cake");
    expect(carrotCake?.alsoIn).toEqual(["Other Deck"]);

    const storeNames = draft.spells
      .filter((spell) => spell.pool === "store")
      .map((spell) => spell.name);
    expect(storeNames).toContain("Test Draft Store Wipe");
    expect(draft.storeAddedCount).toBeGreaterThan(0);
    expect(draft.storeCostCents).toBeGreaterThan(0);

    // Apply all drafted spells + planned lands via addCards and verify the persisted deck hits totalAfterDraft.
    const additions = [
      ...draft.spells.map((spell) => ({ oracleId: spell.oracleId, quantity: 1 })),
      ...draft.manaBase.add.map((entry) => ({
        oracleId: entry.card.oracleId,
        quantity: entry.quantity,
      })),
    ];
    const added = await decks.addCards(jack, { deckId, cards: additions });
    expect(added.ok).toBe(true);

    const view = await deckView(db, jack.userId, deckId);
    const totalCards = view?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
    expect(totalCards).toBe(draft.totalAfterDraft);
  });

  it("excludes store cards when includeStore is 'none' and excludes Game Changers at Bracket 2", async () => {
    await give("Carrot Cake");
    await give("Test Draft Game Changer");
    const deckId = await bezaDeck();

    await decks.updateDeck(jack, { deckId, targetBracket: 2 });
    const coreDraft = await draftForDeck(db, jack.userId, deckId, {
      includeStore: "none",
    });
    expect(coreDraft?.storeAddedCount).toBe(0);
    expect(coreDraft?.spells.map((spell) => spell.name)).toEqual(["Carrot Cake"]);
    expect(coreDraft?.spells.map((spell) => spell.name)).not.toContain("Test Draft Game Changer");

    await decks.updateDeck(jack, { deckId, targetBracket: 3 });
    const upgradedDraft = await draftForDeck(db, jack.userId, deckId, {
      includeStore: "none",
    });
    expect(upgradedDraft?.spells.map((spell) => spell.name)).toContain("Test Draft Game Changer");
  });

  it("returns null for someone else's deck or a deck without a commander", async () => {
    const deckId = await bezaDeck();
    expect(await draftForDeck(db, actor("sam").userId, deckId)).toBeNull();

    const empty = await decks.createDeck(jack, { name: "No Commander", format: "commander" });
    if (!empty.ok) throw new Error(empty.error.kind);
    expect(await draftForDeck(db, jack.userId, empty.value)).toBeNull();
  });

  it("drafts 60-card Standard decks with 4-of playsets without requiring a commander, and refuses Limited", async () => {
    await give("Banishing Light", 4);
    await give("Carrot Cake", 4);
    await give("Test Draft Ramp", 4);

    const created = await decks.createDeck(jack, { name: "Standard White", format: "standard" });
    if (!created.ok) throw new Error(created.error.kind);
    await decks.importList(jack, {
      deckId: created.value,
      text: "2 Carrot Cake\n10 Plains",
    });

    const draft = await draftForDeck(db, jack.userId, created.value);
    if (draft === null) throw new Error("expected 60-card draft");

    expect(draft.existingCount).toBe(12);
    expect(draft.targetTotal).toBe(60);
    expect(draft.totalAfterDraft).toBe(60);
    expect(draft.roleSummary.map((r) => ({ tag: r.tag, target: r.target }))).toEqual([
      { tag: "ramp", target: 4 },
      { tag: "draw", target: 6 },
      { tag: "removal", target: 6 },
      { tag: "wipe", target: 2 },
    ]);

    const carrotCake = draft.spells.find((spell) => spell.name === "Carrot Cake");
    const banishing = draft.spells.find((spell) => spell.name === "Banishing Light");
    expect(carrotCake?.quantity).toBe(2); // 4 owned/limit minus 2 already in deck
    expect(banishing?.quantity).toBe(4);

    const additions = [
      ...draft.spells.map((spell) => ({ oracleId: spell.oracleId, quantity: spell.quantity })),
      ...draft.manaBase.add.map((entry) => ({
        oracleId: entry.card.oracleId,
        quantity: entry.quantity,
      })),
    ];
    const added = await decks.addCards(jack, { deckId: created.value, cards: additions });
    expect(added.ok).toBe(true);

    const view = await deckView(db, jack.userId, created.value);
    const totalCards = view?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
    expect(totalCards).toBe(60);

    const limited = await decks.createDeck(jack, { name: "Draft Pile", format: "limited" });
    if (!limited.ok) throw new Error(limited.error.kind);
    expect(await draftForDeck(db, jack.userId, limited.value)).toBeNull();
  });
});
