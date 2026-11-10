import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { err, UserId } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { becomesADeck, DeckId, MAX_DECKS } from "../domain/deck";
import { fingerprint } from "../domain/list-format";
import { inMemoryCardLookup, inMemoryDeckRepository, samplePrintingId } from "../testing/fakes";
import { makeDecks } from "./make-decks";

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

let repository: ReturnType<typeof inMemoryDeckRepository>;
let decks: ReturnType<typeof makeDecks>;

beforeEach(() => {
  repository = inMemoryDeckRepository();
  const cards = inMemoryCardLookup([
    { oracleId: "bolt", name: "Lightning Bolt", printingId: "bolt-m11" },
    { oracleId: "duress", name: "Duress", printingId: "duress-1" },
    // Two printings of one card: the first is this player's most special copy (a foil).
    { oracleId: "ring", name: "Sol Ring", printingId: "ring-foil", finish: "foil" },
    {
      oracleId: "ring",
      name: "Sol Ring",
      printingId: "ring-c21",
      setCode: "C21",
      collectorNumber: "263",
      finishes: ["nonfoil", "etched"],
    },
    {
      oracleId: "delver",
      name: "Delver of Secrets // Insectile Aberration",
      printingId: "delver-1",
    },
  ]);
  decks = makeDecks({
    unitOfWork: inMemoryUnitOfWork({ decks: repository, cards }),
    clock: fixedClock("2026-09-27T12:00:00Z"),
  });
});

async function newDeck(name = "Burn"): Promise<DeckId> {
  const created = await decks.createDeck(jack, { name, format: "modern" });
  if (!created.ok) throw new Error(created.error.kind);
  return created.value;
}

describe("decks (design doc 09)", () => {
  it("creates decks with a trimmed name, up to the limit (rule 6)", async () => {
    const id = await newDeck("  Burn  ");
    expect(repository.get(id)?.name).toBe("Burn");
    expect(await decks.createDeck(jack, { name: "   ", format: "casual" })).toEqual(
      err({ kind: "NameInvalid", maximum: 60 }),
    );
    for (let index = 1; index < MAX_DECKS; index++) await newDeck(`Deck ${index}`);
    expect(await decks.createDeck(jack, { name: "One more", format: "casual" })).toEqual(
      err({ kind: "TooManyDecks", maximum: 100 }),
    );
  });

  it("sets, changes and removes cards", async () => {
    const id = await newDeck();
    await decks.setEntry(jack, { deckId: id, oracleId: "bolt", board: "main", quantity: 4 });
    await decks.setEntry(jack, { deckId: id, oracleId: "bolt", board: "main", quantity: 3 });
    expect(repository.get(id)?.entries).toEqual([
      { oracleId: "bolt", board: "main", quantity: 3, printingId: null, finish: null },
    ]);
    await decks.setEntry(jack, { deckId: id, oracleId: "bolt", board: "main", quantity: 0 });
    expect(repository.get(id)?.entries).toEqual([]);
  });

  it("refuses unknown cards and bad quantities", async () => {
    const id = await newDeck();
    expect(
      await decks.setEntry(jack, { deckId: id, oracleId: "nope", board: "main", quantity: 1 }),
    ).toEqual(err({ kind: "CardNotFound" }));
    expect(
      await decks.setEntry(jack, { deckId: id, oracleId: "bolt", board: "main", quantity: 100 }),
    ).toEqual(err({ kind: "QuantityInvalid", maximum: 99 }));
  });

  it("keeps each player's decks to themselves (rule 7)", async () => {
    const id = await newDeck();
    const notFound = err({ kind: "DeckNotFound" });
    expect(
      await decks.setEntry(mallory, { deckId: id, oracleId: "bolt", board: "main", quantity: 1 }),
    ).toEqual(notFound);
    expect(await decks.updateDeck(mallory, { deckId: id, name: "Mine" })).toEqual(notFound);
    expect(await decks.deleteDeck(mallory, id)).toEqual(notFound);
    expect(await decks.deleteDeck(jack, id)).toEqual({ ok: true, value: undefined });
    expect(repository.get(id)).toBeUndefined();
  });

  it("imports a pasted list, adding to what's there and reporting what it couldn't use", async () => {
    const id = await newDeck();
    await decks.setEntry(jack, { deckId: id, oracleId: "bolt", board: "main", quantity: 1 });
    const report = await decks.importList(jack, {
      deckId: id,
      text: "3 Lightning Bolt\n1 Delver of Secrets\nSideboard\n2 Duress\n1 Black Lotus\n0 Nothing",
    });
    expect(report).toEqual({
      ok: true,
      value: { added: 6, unreadable: ["0 Nothing"], notFound: ["Black Lotus"] },
    });
    expect(repository.get(id)?.entries).toEqual(
      expect.arrayContaining([
        { oracleId: "bolt", board: "main", quantity: 4, printingId: "bolt-m11", finish: "nonfoil" },
        {
          oracleId: "delver",
          board: "main",
          quantity: 1,
          printingId: "delver-1",
          finish: "nonfoil",
        },
        {
          oracleId: "duress",
          board: "side",
          quantity: 2,
          printingId: "duress-1",
          finish: "nonfoil",
        },
      ]),
    );
  });
});

// Design doc 23: Edit as text.
describe("target bracket (design doc 31)", () => {
  async function commanderDeck(): Promise<DeckId> {
    const created = await decks.createDeck(jack, { name: "Atraxa", format: "commander" });
    if (!created.ok) throw new Error(created.error.kind);
    return created.value;
  }

  it("starts with none, saves one, keeps it on other changes and clears it on request", async () => {
    const id = await commanderDeck();
    expect(repository.get(id)?.targetBracket).toBeNull();
    expect(await decks.updateDeck(jack, { deckId: id, targetBracket: 3 })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(repository.get(id)?.targetBracket).toBe(3);
    await decks.updateDeck(jack, { deckId: id, name: "Atraxa, Grand Unifier" });
    expect(repository.get(id)?.targetBracket).toBe(3);
    await decks.updateDeck(jack, { deckId: id, targetBracket: null });
    expect(repository.get(id)?.targetBracket).toBeNull();
  });

  it("refuses brackets outside 1–5", async () => {
    const id = await commanderDeck();
    for (const target of [0, 6, 2.5]) {
      expect(await decks.updateDeck(jack, { deckId: id, targetBracket: target })).toEqual(
        err({ kind: "TargetBracketInvalid" }),
      );
    }
  });

  it("is only for Commander decks, and leaving Commander clears it (invariant 8)", async () => {
    const modern = await newDeck();
    expect(await decks.updateDeck(jack, { deckId: modern, targetBracket: 2 })).toEqual(
      err({ kind: "TargetBracketNotCommander" }),
    );
    const id = await commanderDeck();
    await decks.updateDeck(jack, { deckId: id, targetBracket: 2 });
    await decks.updateDeck(jack, { deckId: id, format: "casual" });
    expect(repository.get(id)?.targetBracket).toBeNull();
    // A format change and a target together: the target is checked against the new format.
    expect(
      await decks.updateDeck(jack, { deckId: id, format: "commander", targetBracket: 4 }),
    ).toEqual({ ok: true, value: undefined });
    expect(repository.get(id)?.targetBracket).toBe(4);
  });

  it("belongs to the deck's owner", async () => {
    const id = await commanderDeck();
    expect(await decks.updateDeck(mallory, { deckId: id, targetBracket: 2 })).toEqual(
      err({ kind: "DeckNotFound" }),
    );
  });
});

describe("replaceList", () => {
  async function deckWith(
    ...entries: Array<{ oracleId: string; board?: "main" | "side"; quantity: number }>
  ) {
    const id = await newDeck();
    for (const entry of entries) {
      await decks.setEntry(jack, { deckId: id, board: "main", ...entry });
    }
    return id;
  }
  const currentFingerprint = (id: DeckId) => fingerprint(repository.get(id)?.entries ?? []);

  it("replaces the list: removed cards go, quantities change, new cards come in", async () => {
    const id = await deckWith(
      { oracleId: "bolt", quantity: 4 },
      { oracleId: "duress", quantity: 2 },
    );
    const result = await decks.replaceList(jack, {
      deckId: id,
      text: "Deck (3)\n3 Lightning Bolt\nSideboard (1)\n1 Sol Ring",
      fingerprint: currentFingerprint(id),
    });
    expect(result).toEqual({ ok: true, value: { cards: 4 } });
    expect(repository.get(id)?.entries).toEqual([
      { oracleId: "bolt", board: "main", quantity: 3, printingId: null, finish: null },
      // A card new to the deck gets your most special copy (rule 10).
      { oracleId: "ring", board: "side", quantity: 1, printingId: "ring-foil", finish: "foil" },
    ]);
  });

  it("uses a printing the line names", async () => {
    const id = await deckWith();
    await decks.replaceList(jack, {
      deckId: id,
      text: "1 Sol Ring (C21) 263",
      fingerprint: currentFingerprint(id),
    });
    expect(repository.get(id)?.entries[0]).toMatchObject({
      printingId: "ring-c21",
      finish: "nonfoil",
    });
  });

  it("saves nothing when any line can't be used, and lists every problem (rule 1)", async () => {
    const id = await deckWith({ oracleId: "bolt", quantity: 4 });
    const before = repository.get(id);
    const result = await decks.replaceList(jack, {
      deckId: id,
      text: "1 Lightning Bolt\n1 Black Lotus\n0 Nothing\n1 Ingenious Artillerist",
      fingerprint: currentFingerprint(id),
    });
    expect(result).toEqual(
      err({
        kind: "ListProblems",
        unreadable: ["0 Nothing"],
        notFound: ["Black Lotus", "Ingenious Artillerist"],
      }),
    );
    expect(repository.get(id)).toBe(before);
  });

  it("refuses a save when the deck changed since the box was filled (rule 5)", async () => {
    const id = await deckWith({ oracleId: "bolt", quantity: 4 });
    const stale = currentFingerprint(id);
    await decks.setEntry(jack, { deckId: id, oracleId: "duress", board: "main", quantity: 1 });
    const result = await decks.replaceList(jack, {
      deckId: id,
      text: "1 Lightning Bolt",
      fingerprint: stale,
    });
    expect(result).toEqual(err({ kind: "DeckChanged" }));
    expect(repository.get(id)?.entries).toHaveLength(2);
  });

  it("only works on your own decks, and refuses very long lists", async () => {
    const id = await deckWith();
    const input = { deckId: id, text: "1 Lightning Bolt", fingerprint: currentFingerprint(id) };
    expect(await decks.replaceList(mallory, input)).toEqual(err({ kind: "DeckNotFound" }));
    expect(
      await decks.replaceList(jack, { ...input, text: "1 Lightning Bolt\n".repeat(1000) }),
    ).toEqual(err({ kind: "ListTooLong", maximumLines: 1000 }));
  });
});

describe("createDeckFromCards (opened precons)", () => {
  it("keeps printings and boards, and is Commander when there's a commander", async () => {
    const created = await decks.createDeckFromCards(jack, {
      name: "Multiverse Reforged",
      cards: [
        {
          printingId: samplePrintingId("delver-1"),
          finish: "foil",
          quantity: 1,
          board: "commander",
        },
        { printingId: samplePrintingId("bolt-m11"), finish: "nonfoil", quantity: 1, board: "main" },
        {
          printingId: samplePrintingId("not-in-catalog"),
          finish: "nonfoil",
          quantity: 1,
          board: "main",
        },
      ],
    });
    if (!created.ok) throw new Error(created.error.kind);
    const deck = repository.get(created.value);
    expect(deck?.format).toBe("commander");
    expect(deck?.entries).toEqual([
      {
        oracleId: "delver",
        board: "commander",
        quantity: 1,
        printingId: "delver-1",
        finish: "foil",
      },
      { oracleId: "bolt", board: "main", quantity: 1, printingId: "bolt-m11", finish: "nonfoil" },
    ]);
  });

  it("is casual without a commander", async () => {
    const created = await decks.createDeckFromCards(jack, {
      name: "Starter",
      cards: [
        { printingId: samplePrintingId("duress-1"), finish: "nonfoil", quantity: 2, board: "main" },
      ],
    });
    expect(created.ok && repository.get(created.value)?.format).toBe("casual");
  });
});

describe("becomesADeck", () => {
  it("turns precons and starter decks into decks, but not a bundle's land pack", () => {
    expect(becomesADeck("Commander Deck")).toBe(true);
    expect(becomesADeck("Starter Kit")).toBe(true);
    expect(becomesADeck("Bundle Land Pack")).toBe(false);
  });
});

// Design doc 24: choosing a line's printing.
describe("choosePrinting", () => {
  async function deckWithRing() {
    const id = await newDeck();
    await decks.setEntry(jack, { deckId: id, oracleId: "ring", board: "main", quantity: 2 });
    return id;
  }
  const ring = (id: DeckId) => repository.get(id)?.entries.find((e) => e.oracleId === "ring");

  it("pins a printing and finish, and keeps the quantity (rule 3)", async () => {
    const id = await deckWithRing();
    const result = await decks.choosePrinting(jack, {
      deckId: id,
      oracleId: "ring",
      board: "main",
      pinned: { printingId: samplePrintingId("ring-c21"), finish: "etched" },
    });
    expect(result).toEqual({ ok: true, value: undefined });
    expect(ring(id)).toMatchObject({ quantity: 2, printingId: "ring-c21", finish: "etched" });
  });

  it("unpins: the line follows your copies again (rule 4)", async () => {
    const id = await deckWithRing();
    const line = { deckId: id, oracleId: "ring", board: "main" } as const;
    await decks.choosePrinting(jack, {
      ...line,
      pinned: { printingId: samplePrintingId("ring-c21"), finish: "nonfoil" },
    });
    await decks.choosePrinting(jack, { ...line, pinned: null });
    expect(ring(id)).toMatchObject({ quantity: 2, printingId: null, finish: null });
  });

  it("refuses another card's printing, a missing finish, a missing line, and others' decks", async () => {
    const id = await deckWithRing();
    const line = { deckId: id, oracleId: "ring", board: "main" } as const;
    expect(
      await decks.choosePrinting(jack, {
        ...line,
        pinned: { printingId: samplePrintingId("bolt-m11"), finish: "nonfoil" },
      }),
    ).toEqual(err({ kind: "PrintingNotOfCard" }));
    expect(
      await decks.choosePrinting(jack, {
        ...line,
        pinned: { printingId: samplePrintingId("not-in-catalog"), finish: "nonfoil" },
      }),
    ).toEqual(err({ kind: "PrintingNotOfCard" }));
    expect(
      await decks.choosePrinting(jack, {
        ...line,
        pinned: { printingId: samplePrintingId("ring-c21"), finish: "foil" },
      }),
    ).toEqual(err({ kind: "FinishNotAvailable" }));
    expect(await decks.choosePrinting(jack, { ...line, board: "side", pinned: null })).toEqual(
      err({ kind: "EntryNotFound" }),
    );
    expect(await decks.choosePrinting(mallory, { ...line, pinned: null })).toEqual(
      err({ kind: "DeckNotFound" }),
    );
    expect(ring(id)).toMatchObject({ printingId: null, finish: null });
  });
});
