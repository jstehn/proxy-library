import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { PrintingId, SealedProductId, SetCode, type SealedProduct } from "@/modules/catalog";
import { UserId } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import {
  candidate,
  fakePrintingMatcher,
  fakeProductContents,
  inMemoryRealCollectionRepository,
  realCopy,
} from "../testing/fakes";
import { makeRealCollection } from "./make-real-collection";

function actor(id: string): Actor {
  return {
    userId: UserId.of(id),
    username: id as Actor["username"],
    displayName: id as Actor["displayName"],
    isAdmin: false,
    canSelfFund: false,
    mustChangePassword: false,
  };
}
const jack = actor("jack");
const mallory = actor("mallory");

const bolt = candidate({
  printingId: "bolt",
  name: "Lightning Bolt",
  setCode: "M11",
  collectorNumber: "149",
});
const boltPromo = candidate({
  printingId: "bolt-promo",
  name: "Lightning Bolt",
  setCode: "PM11",
  setType: "promo",
});
const boltFoilOnly = candidate({
  printingId: "bolt-foil",
  name: "Lightning Bolt",
  setCode: "F11",
  finishes: ["foil"],
});
const sol = candidate({ printingId: "sol", name: "Sol Ring", finishes: ["nonfoil"] });

const precon: SealedProduct = {
  id: SealedProductId.of("precon"),
  setCode: SetCode.of("SOC"),
  name: "Silverquill Influence",
  category: "deck",
  subtype: null,
  releaseDate: null,
  contents: [
    { kind: "deck", setCode: SetCode.of("SOC"), deckName: "Silverquill Influence" },
    { kind: "pack", setCode: SetCode.of("SOS"), boosterType: "collector" },
  ],
};
const preconList = {
  type: "Commander Deck",
  cards: [
    {
      printingId: PrintingId.of("bolt"),
      finish: "nonfoil" as const,
      quantity: 1,
      board: "commander" as const,
    },
    {
      printingId: PrintingId.of("sol"),
      finish: "nonfoil" as const,
      quantity: 2,
      board: "main" as const,
    },
  ],
};

let repository: ReturnType<typeof inMemoryRealCollectionRepository>;
let realCollection: ReturnType<typeof makeRealCollection>;

beforeEach(() => {
  repository = inMemoryRealCollectionRepository();
  realCollection = makeRealCollection({
    unitOfWork: inMemoryUnitOfWork({
      realCollection: repository,
      printingMatcher: fakePrintingMatcher([bolt, boltPromo, boltFoilOnly, sol]),
      productContents: fakeProductContents([precon], { "SOC/Silverquill Influence": preconList }),
    }),
    clock: fixedClock("2026-10-29T12:00:00Z"),
  });
});

const rowsOf = (who: Actor) => repository.rows.get(who.userId) ?? [];

describe("setRealCopies", () => {
  it("sets a quantity (not adds), and 0 deletes the row", async () => {
    await realCollection.setRealCopies(jack, realCopy("bolt", 3));
    await realCollection.setRealCopies(jack, realCopy("bolt", 3));
    expect(rowsOf(jack)).toEqual([realCopy("bolt", 3)]);
    await realCollection.setRealCopies(jack, realCopy("bolt", 0));
    expect(rowsOf(jack)).toEqual([]);
  });

  it("refuses bad quantities, unknown printings and finishes the printing never had", async () => {
    expect(await realCollection.setRealCopies(jack, realCopy("bolt", 10_000))).toMatchObject({
      error: { kind: "QuantityInvalid" },
    });
    expect(await realCollection.setRealCopies(jack, realCopy("bolt", 1.5))).toMatchObject({
      error: { kind: "QuantityInvalid" },
    });
    expect(await realCollection.setRealCopies(jack, realCopy("nope", 1))).toMatchObject({
      error: { kind: "PrintingNotFound" },
    });
    expect(await realCollection.setRealCopies(jack, realCopy("sol", 1, "foil"))).toMatchObject({
      error: { kind: "FinishNotAvailable", finishes: ["nonfoil"] },
    });
  });

  it("only changes the actor's own collection", async () => {
    await realCollection.setRealCopies(mallory, realCopy("bolt", 1));
    expect(rowsOf(jack)).toEqual([]);
  });
});

describe("changeRealPrinting", () => {
  it("moves a row to another printing of the same card, merging with what's there", async () => {
    await realCollection.setRealCopies(jack, realCopy("bolt", 2));
    await realCollection.setRealCopies(jack, realCopy("bolt-promo", 1));
    const moved = await realCollection.changeRealPrinting(
      jack,
      realCopy("bolt", 0),
      realCopy("bolt-promo", 0),
    );
    expect(moved).toEqual({ ok: true, value: realCopy("bolt-promo", 3) });
    expect(rowsOf(jack)).toEqual([realCopy("bolt-promo", 3)]);
  });

  it("refuses a different card, a row you don't have, and a missing finish", async () => {
    await realCollection.setRealCopies(jack, realCopy("bolt", 2));
    expect(
      await realCollection.changeRealPrinting(jack, realCopy("bolt", 0), realCopy("sol", 0)),
    ).toMatchObject({
      error: { kind: "NotTheSameCard" },
    });
    expect(
      await realCollection.changeRealPrinting(jack, realCopy("sol", 0), realCopy("sol", 0)),
    ).toMatchObject({
      error: { kind: "NotOwned" },
    });
    expect(
      await realCollection.changeRealPrinting(jack, realCopy("bolt", 0), realCopy("bolt-foil", 0)),
    ).toMatchObject({ error: { kind: "FinishNotAvailable" } });
  });
});

describe("importing", () => {
  it("previews matched and unmatched lines with the plan, then imports exactly that", async () => {
    const preview = await realCollection.previewImport(jack, {
      text: "3 Lightning Bolt\n1 Sol Ring *F*\n1 Nobody Special",
      mode: "add",
    });
    if (!preview.ok) throw new Error(preview.error.kind);
    expect(preview.value.lines.map((line) => line.kind)).toEqual([
      "Matched",
      "Unmatched",
      "Unmatched",
    ]);
    expect(preview.value.plan.added).toEqual([realCopy("bolt", 3)]);

    const applied = await realCollection.applyImport(jack, {
      copies: preview.value.plan.added,
      mode: "add",
      version: preview.value.version,
    });
    expect(applied.ok).toBe(true);
    expect(rowsOf(jack)).toEqual([realCopy("bolt", 3)]);
  });

  it("refuses an import when the collection changed after the preview (another tab)", async () => {
    const preview = await realCollection.previewImport(jack, {
      text: "1 Lightning Bolt",
      mode: "replace",
    });
    if (!preview.ok) throw new Error(preview.error.kind);
    await realCollection.setRealCopies(jack, realCopy("sol", 1));
    const applied = await realCollection.applyImport(jack, {
      copies: [realCopy("bolt", 1)],
      mode: "replace",
      version: preview.value.version,
    });
    expect(applied).toEqual({ ok: false, error: { kind: "CollectionChanged" } });
    expect(rowsOf(jack)).toEqual([realCopy("sol", 1)]);
  });

  it("refuses empty, oversized and unrecognized imports", async () => {
    expect(await realCollection.previewImport(jack, { text: "\n\n", mode: "add" })).toMatchObject({
      error: { kind: "ImportEmpty" },
    });
    expect(
      await realCollection.previewImport(jack, {
        text: "1 Sol Ring\n".repeat(20_001),
        mode: "add",
      }),
    ).toMatchObject({ error: { kind: "ImportTooLarge" } });
    expect(
      await realCollection.previewImport(jack, { text: "a,b,c\n1,2,3", mode: "add" }),
    ).toMatchObject({
      error: { kind: "FormatNotRecognized" },
    });
  });

  it("re-checks the confirmed printings: a tampered finish is refused", async () => {
    const version = { updatedAt: null, rows: 0 };
    expect(
      await realCollection.applyImport(jack, {
        copies: [realCopy("sol", 1, "foil")],
        mode: "add",
        version,
      }),
    ).toMatchObject({ error: { kind: "FinishNotAvailable" } });
  });
});

describe("clearing and sharing", () => {
  it("clears only the actor's rows, and records the sharing switch", async () => {
    await realCollection.setRealCopies(jack, realCopy("bolt", 1));
    await realCollection.setRealCopies(mallory, realCopy("bolt", 1));
    expect(await realCollection.clearRealCollection(jack)).toBe(1);
    expect(rowsOf(jack)).toEqual([]);
    expect(rowsOf(mallory)).toHaveLength(1);
    await realCollection.setRealSharing(jack, true);
    expect(repository.settings.get(jack.userId)).toBe(true);
  });
});

describe("real products (section 15)", () => {
  it("adds exactly the product's known cards and returns its decks and what wasn't added", async () => {
    const added = await realCollection.addRealProduct(jack, { productId: precon.id, choices: [] });
    if (!added.ok) throw new Error(added.error.kind);
    expect(rowsOf(jack)).toEqual([realCopy("bolt", 1), realCopy("sol", 2)]);
    expect(added.value.cards.decks.map((deck) => deck.name)).toEqual(["Silverquill Influence"]);
    expect(added.value.cards.notAdded).toEqual(["SOS collector booster"]);
    expect(repository.products).toHaveLength(1);
  });

  it("adding the same product twice doubles the cards", async () => {
    await realCollection.addRealProduct(jack, { productId: precon.id, choices: [] });
    await realCollection.addRealProduct(jack, { productId: precon.id, choices: [] });
    expect(rowsOf(jack)).toEqual([realCopy("bolt", 2), realCopy("sol", 4)]);
    expect(repository.products).toHaveLength(2);
  });

  it("removing with 'also remove its cards' subtracts them, never below 0", async () => {
    const added = await realCollection.addRealProduct(jack, { productId: precon.id, choices: [] });
    if (!added.ok) throw new Error(added.error.kind);
    await realCollection.setRealCopies(jack, realCopy("sol", 5));
    await realCollection.setRealCopies(jack, realCopy("bolt", 0));
    await realCollection.removeRealProduct(jack, {
      realProductId: added.value.realProductId,
      removeCards: true,
    });
    expect(rowsOf(jack)).toEqual([realCopy("sol", 3)]);
    expect(repository.products).toEqual([]);
  });

  it("removing without it keeps the cards; nobody else can remove your product", async () => {
    const added = await realCollection.addRealProduct(jack, { productId: precon.id, choices: [] });
    if (!added.ok) throw new Error(added.error.kind);
    const id = added.value.realProductId;
    expect(
      await realCollection.removeRealProduct(mallory, { realProductId: id, removeCards: true }),
    ).toEqual({
      ok: false,
      error: { kind: "NotOwned" },
    });
    await realCollection.removeRealProduct(jack, { realProductId: id, removeCards: false });
    expect(rowsOf(jack)).toHaveLength(2);
  });

  it("an unknown product is refused", async () => {
    expect(
      await realCollection.addRealProduct(jack, {
        productId: SealedProductId.of("nope"),
        choices: [],
      }),
    ).toEqual({ ok: false, error: { kind: "ProductNotFound" } });
  });
});
