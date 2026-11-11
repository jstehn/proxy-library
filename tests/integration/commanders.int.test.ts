// Commanders I can build (design doc 36, section 9) against real Postgres. The test adds a few
// cards of its own (in the fixture's Bloomburrow set) so the counts are known.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { commanderDetails, commandersICanBuild, makeDecks } from "@/modules/decks";
import { actor, clock, close, db, loadFixtureCatalog, resetPlayers, unitOfWork } from "./harness";

afterAll(close);

type TestCard = Readonly<{
  name: string;
  typeLine: string;
  identity: string[];
  text?: string;
  roles?: string[];
  edhrecRank?: number;
  /** A store price makes it for sale. */
  priceCents?: number;
}>;

const textArray = (values: readonly string[]) =>
  sql`${`{${values.map((value) => `"${value}"`).join(",")}}`}::text[]`;

const oracleIds = new Map<string, string>();
let collectorNumber = 900;

async function addCard(card: TestCard): Promise<void> {
  const id = randomUUID();
  const oracleId = randomUUID();
  oracleIds.set(card.name, oracleId);
  collectorNumber += 1;
  const faces = [{ name: card.name, text: card.text ?? "", power: "2", toughness: "2" }];
  await db.execute(sql`
    insert into printings (id, set_code, collector_number, name, oracle_id, scryfall_id, rarity,
                           colors, color_identity, mana_value, type_line, layout, finishes,
                           border_color, frame_version, frame_effects, promo_types, is_full_art,
                           variant_label, faces, legalities, role_tags, edhrec_rank)
    values (${id}, 'BLB', ${`${collectorNumber}`}, ${card.name}, ${oracleId}, ${randomUUID()},
            'rare', ${textArray(card.identity)}, ${textArray(card.identity)}, 3, ${card.typeLine},
            'normal', '{nonfoil}', 'black', '2015', '{}', '{}', false, '',
            ${JSON.stringify(faces)}::jsonb, '{"commander": "legal"}'::jsonb,
            ${textArray(card.roles ?? [])}, ${card.edhrecRank ?? null})`);
  if (card.priceCents !== undefined) {
    await db.execute(sql`
      insert into price_snapshots (printing_id, finish, day, usd_cents)
      values (${id}, 'nonfoil', '2026-11-01', ${card.priceCents})`);
  }
}

beforeAll(async () => {
  await loadFixtureCatalog();
  const rabbit = { typeLine: "Creature — Rabbit", identity: ["W"] };
  await addCard({
    name: "Test Rabbit Lord",
    typeLine: "Legendary Creature — Rabbit Noble",
    identity: ["W"],
    text: "Other Rabbits you control get +1/+1.",
    edhrecRank: 450,
  });
  await addCard({
    name: "Test Lone Legend",
    typeLine: "Legendary Creature — Human Advisor",
    identity: ["W"],
    text: "Will of the council — Starting with you, each player votes for grace or condemnation.",
    edhrecRank: 80,
  });
  await addCard({ name: "Test Bunny One", ...rabbit });
  await addCard({ name: "Test Bunny Two", ...rabbit });
  await addCard({ name: "Test Bunny Three", ...rabbit });
  await addCard({ name: "Test Blue Draw", typeLine: "Sorcery", identity: ["U"], roles: ["draw"] });
  await addCard({
    name: "Test Store Legend",
    typeLine: "Legendary Creature — Bird",
    identity: ["W"],
    priceCents: 300,
  });
  await addCard({
    name: "Test Store Draw",
    typeLine: "Sorcery",
    identity: ["W"],
    roles: ["draw"],
    priceCents: 40,
  });
});
beforeEach(() => resetPlayers(["jack"]));

const decks = makeDecks({ unitOfWork, clock });
const jack = actor("jack");

async function give(name: string): Promise<void> {
  await db.execute(sql`
    insert into collection_cards (user_id, printing_id, finish, quantity)
    select ${jack.userId}, p.id, 'nonfoil', 1 from printings p where p.name = ${name} limit 1
  `);
}

async function giveAll(): Promise<void> {
  for (const name of [
    "Test Rabbit Lord",
    "Test Lone Legend",
    "Test Bunny One",
    "Test Bunny Two",
    "Test Bunny Three",
    "Test Blue Draw",
  ]) {
    await give(name);
  }
}

describe("commanders I can build", () => {
  it("ranks the legend your cards support first, counting cards other decks use", async () => {
    await giveAll();
    const other = await decks.createDeck(jack, { name: "Bunnies", format: "commander" });
    if (!other.ok) throw new Error(other.error.kind);
    await decks.importList(jack, {
      deckId: other.value,
      text: "Commander\n1 Test Rabbit Lord\nDeck\n1 Test Bunny One",
    });

    const ranked = await commandersICanBuild(db, jack.userId);
    expect(ranked.map((entry) => entry.commander.name)).toEqual([
      "Test Rabbit Lord",
      "Test Lone Legend",
    ]);
    const [lord, lone] = ranked;
    expect(lord.plan.tribes).toEqual(["Rabbit"]);
    expect(lord.onPlan).toBe(3); // Bunny One is in another deck: still yours here
    expect(lord.filled).toBe(4); // three Rabbits and the Lone Legend; the blue card is off-color
    expect(lord.commander.leads).toEqual(["Bunnies"]);
    expect(lone.onPlan).toBe(0);
    expect(ranked.some((entry) => entry.commander.name === "Test Store Legend")).toBe(false);
  });

  it("adds store legends with their price only when asked, and filters by color", async () => {
    await giveAll();
    const withStore = await commandersICanBuild(db, jack.userId, { includeStore: true });
    const store = withStore.find((entry) => entry.commander.name === "Test Store Legend");
    expect(store?.commander.ownedCopies).toBe(0);
    expect(store?.commander.priceCents).toBe(300);
    expect(withStore.filter((entry) => entry.commander.name === "Test Rabbit Lord")).toHaveLength(
      1,
    );

    const white = await commandersICanBuild(db, jack.userId, { colors: ["W"] });
    expect(white.map((entry) => entry.commander.name)).toContain("Test Rabbit Lord");
    const blue = await commandersICanBuild(db, jack.userId, { colors: ["U"] });
    expect(blue.map((entry) => entry.commander.name)).not.toContain("Test Rabbit Lord");
  });

  it("details one commander, with the cheapest store cards for what's missing", async () => {
    await giveAll();
    const details = await commanderDetails(
      db,
      jack.userId,
      oracleIds.get("Test Rabbit Lord") ?? "",
    );
    expect(details?.onPlan.map((entry) => entry.card.name).sort()).toEqual([
      "Test Bunny One",
      "Test Bunny Three",
      "Test Bunny Two",
    ]);
    const draw = details?.missing.picks.filter((pick) => pick.fills === "draw") ?? [];
    expect(draw.map((pick) => pick.card.name)).toContain("Test Store Draw");
    expect(details?.missing.picks.every((pick) => pick.card.pool === "store")).toBe(true);
    expect(details?.missing.picks.map((pick) => pick.card.name)).not.toContain("Test Blue Draw");
  });

  it("refuses a card that can't lead a deck", async () => {
    expect(
      await commanderDetails(db, jack.userId, oracleIds.get("Test Bunny One") ?? ""),
    ).toBeNull();
  });

  it("filters by theme or tribe and orders by popularity", async () => {
    await giveAll();
    const politics = await commandersICanBuild(db, jack.userId, { theme: "politics" });
    expect(politics.map((entry) => entry.commander.name)).toEqual(["Test Lone Legend"]);
    expect(politics[0]?.commander.text).toContain("Will of the council");
    expect(politics[0]?.commander.typeLine).toBe("Legendary Creature — Human Advisor");

    const rabbits = await commandersICanBuild(db, jack.userId, { tribe: "rabbit" });
    expect(rabbits.map((entry) => entry.commander.name)).toEqual(["Test Rabbit Lord"]);

    const byPopularity = await commandersICanBuild(db, jack.userId, { sort: "popularity" });
    expect(byPopularity.map((entry) => entry.commander.name)).toEqual([
      "Test Lone Legend",
      "Test Rabbit Lord",
    ]);
    expect(byPopularity[0]?.commander.edhrecRank).toBe(80);
  });
});
