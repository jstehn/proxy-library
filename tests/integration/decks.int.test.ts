// The deck builder against real Postgres and the fixture catalog (design doc 09, section 11).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrintingId } from "@/modules/catalog";
import {
  deckProblems,
  deckView,
  decksFor,
  makeDecks,
  ownedCardsNamed,
  type DeckId,
} from "@/modules/decks";
import { makeStore } from "@/modules/store";
import { UserId } from "@/shared/kernel";
import { actor, clock, close, db, loadFixtureCatalog, resetPlayers, unitOfWork } from "./harness";

afterAll(close);

const decks = makeDecks({ unitOfWork, clock });
const store = makeStore({ unitOfWork, clock });
const jack = actor("jack");

/** A priced nonfoil printing from the fixture set, and its name. */
async function card(): Promise<{ id: PrintingId; name: string }> {
  const [row] = (
    await db.execute<{ id: string; name: string }>(sql`
      select p.id, p.name from printings p
        join price_snapshots s on s.printing_id = p.id and s.finish = 'nonfoil'
       where p.set_code = 'BLB' and p.rarity = 'common' and p.type_line not like 'Basic%'
       order by s.usd_cents, p.id limit 1
    `)
  ).rows;
  return { id: PrintingId.of(row.id), name: row.name };
}

beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack"]));

async function newDeck(): Promise<DeckId> {
  const created = await decks.createDeck(jack, { name: "Test", format: "casual" });
  if (!created.ok) throw new Error(created.error.kind);
  return created.value;
}

describe("decks", () => {
  it("counts what a deck is short, as copies are bought and sold (shared ownership)", async () => {
    const { id: printingId, name } = await card();
    const deckId = await newDeck();
    const report = await decks.importList(jack, { deckId, text: `3 ${name}\n20 Plains` });
    expect(report.ok && report.value.notFound).toEqual([]);

    const shortBy = async () => (await decksFor(db, jack.userId))[0].short;
    expect(await shortBy()).toBe(3); // Plains is a basic land: never short

    await store.buySingle(jack, { printingId, finish: "nonfoil", quantity: 2 });
    expect(await shortBy()).toBe(1);
    await store.sellSingle(jack, { printingId, finish: "nonfoil", quantity: 1 });
    expect(await shortBy()).toBe(2);
  });

  it("shows each line with its owned count, the other decks using it, and the rules", async () => {
    const { id: printingId, name } = await card();
    await store.buySingle(jack, { printingId, finish: "nonfoil", quantity: 1 });
    const first = await newDeck();
    const second = await newDeck();
    await decks.updateDeck(jack, { deckId: second, name: "Second" });
    for (const deckId of [first, second])
      await decks.importList(jack, { deckId, text: `1 ${name}` });

    const view = await deckView(db, jack.userId, first);
    if (view === null) throw new Error("no deck");
    expect(view.lines).toEqual([
      expect.objectContaining({ name, quantity: 1, owned: 1, otherDecks: ["Second"], printingId }),
    ]);
    // The importer pinned the printing Jack owns.
    const owned = (oracleId: string) =>
      view.lines.find((line) => line.oracleId === oracleId)?.owned ?? 0;
    expect(deckProblems(view.deck, (oracleId) => view.rules[oracleId], owned)).toEqual([]);
    expect(await deckView(db, UserId.of("someone-else"), first)).toBeNull();
  });

  it("finds owned cards by name for the builder's search", async () => {
    const { id: printingId, name } = await card();
    await store.buySingle(jack, { printingId, finish: "nonfoil", quantity: 2 });
    const matches = await ownedCardsNamed(db, jack.userId, name.slice(0, 5));
    expect(matches).toEqual([expect.objectContaining({ name, owned: 2, printingId })]);
  });
});
