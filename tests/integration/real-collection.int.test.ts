// The real collection against real Postgres and the fixture catalog (design doc 16, section 12).
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrintingId, SealedProductId } from "@/modules/catalog";
import { makeResetPlayer } from "@/modules/reset";
import {
  isRealCollectionShared,
  makeRealCollection,
  matchedCopies,
  realCollectionPage,
  realProductsOf,
} from "@/modules/real-collection";
import {
  actor,
  clock,
  close,
  count,
  db,
  loadFixtureCatalog,
  resetPlayers,
  unitOfWork,
} from "./harness";

afterAll(close);

const realCollection = makeRealCollection({ unitOfWork, clock });
const jack = actor("jack");
const admin = actor("admin", true);
const fixture = (name: string) => readFileSync(`tests/fixtures/real-collection/${name}`, "utf8");

beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack", "admin"]));

/** A printing's id by set and collector number. */
async function printing(setCode: string, number: string): Promise<PrintingId> {
  const [row] = (
    await db.execute<{ id: string }>(
      sql`select id from printings where set_code = ${setCode} and collector_number = ${number}`,
    )
  ).rows;
  return PrintingId.of(row.id);
}

async function importText(text: string, mode: "add" | "replace" = "add") {
  const preview = await realCollection.previewImport(jack, { text, mode });
  if (!preview.ok) throw new Error(preview.error.kind);
  const applied = await realCollection.applyImport(jack, {
    copies: matchedCopies(preview.value.lines),
    mode,
    version: preview.value.version,
  });
  if (!applied.ok) throw new Error(applied.error.kind);
  return preview.value;
}

describe("matching (one query per import)", () => {
  it("matches a ManaBox file by Scryfall id, including a reference set's promo", async () => {
    const preview = await importText(fixture("manabox.csv"));
    expect(preview.lines.map((line) => line.kind)).toEqual([
      "Matched",
      "Matched",
      "Matched",
      "Unmatched",
    ]);
    expect(preview.unreadable).toHaveLength(1);
    const [beza, , promo] = preview.lines;
    expect(beza.kind === "Matched" && beza.printingId).toBe(await printing("BLB", "2"));
    expect(promo.kind === "Matched" && promo.printingId).toBe(await printing("PBLB", "2p"));
  });

  it("matches by set and number, by name to the newest ordinary printing, and says why not", async () => {
    const preview = await realCollection.previewImport(jack, {
      text: fixture("moxfield.csv"),
      mode: "add",
    });
    if (!preview.ok) throw new Error(preview.error.kind);
    const [truce, borderless, talent, redeemer] = preview.value.lines;
    expect(truce.kind === "Matched" && truce.printingId).toBe(await printing("BLB", "9"));
    expect(borderless.kind === "Matched" && borderless.printingId).toBe(
      await printing("BLB", "295"),
    );
    // No number: the regular Caretaker's Talent, not the PBLB promos.
    expect(talent.kind === "Matched" && talent.printingId).toBe(await printing("BLB", "6"));
    // Serra Redeemer #387 is nonfoil only.
    expect(redeemer).toMatchObject({
      kind: "Unmatched",
      reason: { kind: "FinishNotAvailable", finishes: ["nonfoil"] },
    });
  });

  it("reads the list fixture: name only, unknown card, a foil-only special printing", async () => {
    const preview = await realCollection.previewImport(jack, {
      text: fixture("list.txt"),
      mode: "add",
    });
    if (!preview.ok) throw new Error(preview.error.kind);
    const kinds = preview.value.lines.map((line) => [line.line.name, line.kind]);
    expect(kinds).toEqual([
      ["Beza, the Bounding Spring", "Matched"],
      ["Banishing Light", "Matched"],
      ["Dawn's Truce", "Matched"],
      ["Plains", "Matched"],
      ["Carrot Cake", "Matched"],
      ["Lumra, Bellow of the Woods", "Unmatched"], // only a foil borderless printing
      ["Brave-Kin Duo", "Matched"],
    ]);
  });
});

describe("the repository", () => {
  it("imports, replaces, and refuses a stale preview", async () => {
    await importText(fixture("ours.csv"));
    expect(await count("real_cards", "user_id = 'jack'")).toBe(2);
    await importText("1 Carrot Cake", "replace");
    expect(await count("real_cards", "user_id = 'jack'")).toBe(1);

    const stale = await realCollection.previewImport(jack, { text: "4 Carrot Cake", mode: "add" });
    if (!stale.ok) throw new Error(stale.error.kind);
    await realCollection.setRealCopies(jack, {
      printingId: await printing("BLB", "1"),
      finish: "nonfoil",
      quantity: 1,
    });
    const applied = await realCollection.applyImport(jack, {
      copies: matchedCopies(stale.value.lines),
      mode: "add",
      version: stale.value.version,
    });
    expect(applied).toEqual({ ok: false, error: { kind: "CollectionChanged" } });
  });

  it("shows the real collection with its value, and a sharing switch that's off by default", async () => {
    await importText(fixture("ours.csv"));
    const page = await realCollectionPage(db, jack.userId, {
      sections: "none",
      sort: "name",
      page: 1,
    });
    expect(page.totals).toMatchObject({ different: 2, copies: 3 });
    expect(page.totals.valueCents).toBeGreaterThan(0);
    expect(await isRealCollectionShared(db, jack.userId)).toBe(false);
    await realCollection.setRealSharing(jack, true);
    expect(await isRealCollectionShared(db, jack.userId)).toBe(true);
  });
});

describe("real products", () => {
  it("records the starter kit and adds its deck's cards; removing takes them back out", async () => {
    const [kit] = (
      await db.execute<{ id: string }>(
        sql`select id from sealed_products where name = 'Bloomburrow Starter Kit'`,
      )
    ).rows;
    const added = await realCollection.addRealProduct(jack, {
      productId: SealedProductId.of(kit.id),
      choices: [],
    });
    if (!added.ok) throw new Error(added.error.kind);
    expect(added.value.cards.decks.map((deck) => deck.name)).toContain("Hare Raising");
    const copies = await count("real_cards", "user_id = 'jack'");
    expect(copies).toBeGreaterThan(0);
    expect(await realProductsOf(db, jack.userId)).toHaveLength(1);

    await realCollection.removeRealProduct(jack, {
      realProductId: added.value.realProductId,
      removeCards: true,
    });
    expect(await count("real_cards", "user_id = 'jack'")).toBe(0);
    expect(await realProductsOf(db, jack.userId)).toEqual([]);
  });
});

describe("isolation (rule 9)", () => {
  it("resetting a player leaves their real collection alone", async () => {
    await importText(fixture("ours.csv"));
    const reset = makeResetPlayer({ unitOfWork, clock });
    const result = await reset(admin, jack.userId);
    expect(result.ok).toBe(true);
    expect(await count("real_cards", "user_id = 'jack'")).toBe(2);
  });

  it("deleting the player deletes their real collection", async () => {
    await importText(fixture("ours.csv"));
    await db.execute(sql`delete from players where user_id = 'jack'`);
    expect(await count("real_cards", "user_id = 'jack'")).toBe(0);
  });
});
