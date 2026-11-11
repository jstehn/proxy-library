// A mana base you could start from (design doc 35, section 9) against real Postgres. The fixture
// catalog's only land is Plains, so the test adds a few lands of its own.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeDecks, manaBasePlan, type DeckId, type ManaBasePlan } from "@/modules/decks";
import { actor, clock, close, db, loadFixtureCatalog, resetPlayers, unitOfWork } from "./harness";

afterAll(close);
beforeAll(async () => {
  await loadFixtureCatalog();
  await addLand({ name: "Test Bastion", identity: ["W"], produced: ["W"], text: "{T}: Add {W}." });
  await addLand({
    name: "Test Library",
    identity: [],
    produced: ["C"],
    text: "{T}: Add {C}. {2}, {T}: Draw a card.",
    roles: ["draw"],
  });
  await addLand({ name: "Test Lagoon", identity: ["U"], produced: ["U"], text: "{T}: Add {U}." });
  await addLand({
    name: "Test Monument",
    identity: ["W"],
    produced: ["W"],
    text: "{T}: Add {W}. {3}{W}, {T}: Exile target creature.",
    roles: ["removal"],
    priceCents: 75,
  });
});
beforeEach(() => resetPlayers(["jack", "sam"]));

const decks = makeDecks({ unitOfWork, clock });
const jack = actor("jack");

type TestLand = Readonly<{
  name: string;
  identity: string[];
  produced: string[];
  text: string;
  roles?: string[];
  /** A store price makes it for sale (in the fixture's Bloomburrow set). */
  priceCents?: number;
}>;

const textArray = (values: readonly string[]) =>
  sql`${`{${values.map((value) => `"${value}"`).join(",")}}`}::text[]`;

async function addLand(land: TestLand): Promise<void> {
  const id = randomUUID();
  const faces = [{ name: land.name, text: land.text, power: null, toughness: null }];
  await db.execute(sql`
    insert into printings (id, set_code, collector_number, name, oracle_id, scryfall_id, rarity,
                           colors, color_identity, mana_value, type_line, layout, finishes,
                           border_color, frame_version, frame_effects, promo_types, is_full_art,
                           variant_label, faces, legalities, produced_mana, role_tags)
    values (${id}, 'BLB', ${`9${land.name.length}${land.name.charCodeAt(5)}`}, ${land.name},
            ${randomUUID()}, ${randomUUID()}, 'uncommon', '{}', ${textArray(land.identity)}, 0,
            'Land', 'normal', '{nonfoil}', 'black', '2015', '{}', '{}', false, '',
            ${JSON.stringify(faces)}::jsonb, '{"commander": "legal"}'::jsonb,
            ${textArray(land.produced)}, ${textArray(land.roles ?? [])})`);
  if (land.priceCents !== undefined) {
    await db.execute(sql`
      insert into price_snapshots (printing_id, finish, day, usd_cents)
      values (${id}, 'nonfoil', '2026-11-01', ${land.priceCents})`);
  }
}

async function give(name: string, quantity = 1): Promise<void> {
  await db.execute(sql`
    insert into collection_cards (user_id, printing_id, finish, quantity)
    select ${jack.userId}, p.id, 'nonfoil', ${quantity} from printings p
     where p.name = ${name} order by p.collector_number limit 1
  `);
}

async function deck(name: string, list: string): Promise<DeckId> {
  const created = await decks.createDeck(jack, { name, format: "commander" });
  if (!created.ok) throw new Error(created.error.kind);
  await decks.importList(jack, { deckId: created.value, text: list });
  return created.value;
}

const added = (plan: ManaBasePlan | null) =>
  Object.fromEntries(plan?.add.map((entry) => [entry.card.name, entry.quantity]) ?? []);

describe("mana base plan", () => {
  it("adds your lands, even ones another deck plays, then Plains, and lists store lands", async () => {
    await give("Test Bastion");
    await give("Test Library");
    await give("Test Lagoon"); // blue: outside Beza's colors
    await deck("Other deck", "Deck\n1 Test Bastion");
    const deckId = await deck("Beza", "Commander\n1 Beza, the Bounding Spring\nDeck\n20 Plains");

    const plan = await manaBasePlan(db, jack.userId, deckId);
    expect(plan?.lands).toBe(20);
    expect(plan?.sources.map((source) => source.color)).toEqual(["W"]);
    const lands = added(plan);
    expect(lands["Test Bastion"]).toBe(1);
    expect(lands["Test Library"]).toBe(1); // draws: Beza's deck is short of card draw
    expect(lands["Test Lagoon"]).toBeUndefined();
    expect(lands.Plains).toBe((plan?.landTarget.lands ?? 0) - 20 - 2);
    const bastion = plan?.add.find((entry) => entry.card.name === "Test Bastion");
    expect(bastion?.card.alsoIn).toEqual(["Other deck"]);

    expect(plan?.considerBuying.map((entry) => entry.card.name)).toEqual(["Test Monument"]);
    expect(plan?.considerBuying[0].card.priceCents).toBe(75);
  });

  it("refuses someone else's deck", async () => {
    const deckId = await deck("Beza", "Commander\n1 Beza, the Bounding Spring");
    expect(await manaBasePlan(db, actor("sam").userId, deckId)).toBeNull();
  });
});
