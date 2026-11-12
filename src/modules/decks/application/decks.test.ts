import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { err, UserId } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { becomesADeck, DeckId, MAX_DECKS } from "../domain/deck";
import { fingerprint } from "../domain/list-format";
import { MAX_NOTE_LENGTH } from "../domain/notes";
import { MAX_SNAPSHOT_LABEL_LENGTH, MAX_SNAPSHOTS_PER_DECK, SnapshotId } from "../domain/snapshots";
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
      {
        oracleId: "bolt",
        board: "main",
        quantity: 3,
        printingId: null,
        finish: null,
        heading: null,
        note: null,
      },
    ]);
    await decks.setEntry(jack, { deckId: id, oracleId: "bolt", board: "main", quantity: 0 });
    expect(repository.get(id)?.entries).toEqual([]);
  });

  it("adds several cards to the main deck at once, on top of what's there (design doc 35)", async () => {
    const id = await newDeck();
    await decks.setEntry(jack, { deckId: id, oracleId: "bolt", board: "main", quantity: 2 });
    const added = await decks.addCards(jack, {
      deckId: id,
      cards: [
        { oracleId: "bolt", quantity: 1 },
        { oracleId: "duress", quantity: 3 },
      ],
    });
    expect(added.ok).toBe(true);
    const quantities = repository.get(id)?.entries.map((entry) => [entry.oracleId, entry.quantity]);
    expect(quantities?.sort()).toEqual([
      ["bolt", 3],
      ["duress", 3],
    ]);
  });

  it("adds nothing when one card can't be added", async () => {
    const id = await newDeck();
    const result = await decks.addCards(jack, {
      deckId: id,
      cards: [
        { oracleId: "bolt", quantity: 1 },
        { oracleId: "no-such-card", quantity: 1 },
      ],
    });
    expect(result).toEqual(err({ kind: "CardNotFound" }));
    expect(repository.get(id)?.entries).toEqual([]);
    expect(await decks.addCards(mallory, { deckId: id, cards: [] })).toEqual(
      err({ kind: "DeckNotFound" }),
    );
  });

  it("applies changes all-or-nothing and refuses a stale fingerprint (design doc 40)", async () => {
    const id = await newDeck();
    await decks.setEntry(jack, { deckId: id, oracleId: "bolt", board: "main", quantity: 2 });
    const firstPrint = fingerprint(repository.get(id)?.entries ?? []);

    const applied = await decks.applyChanges(jack, {
      deckId: id,
      fingerprint: firstPrint,
      changes: [
        { oracleId: "bolt", board: "main", quantity: 0 },
        { oracleId: "bolt", board: "maybe", quantity: 2 },
        { oracleId: "duress", board: "main", quantity: 3 },
      ],
    });
    expect(applied.ok).toBe(true);
    expect(
      repository
        .get(id)
        ?.entries.map((entry) => [entry.board, entry.oracleId, entry.quantity])
        .sort(),
    ).toEqual([
      ["main", "duress", 3],
      ["maybe", "bolt", 2],
    ]);

    // Stale fingerprint fails cleanly without saving anything.
    const stale = await decks.applyChanges(jack, {
      deckId: id,
      fingerprint: firstPrint,
      changes: [{ oracleId: "duress", board: "main", quantity: 0 }],
    });
    expect(stale).toEqual(err({ kind: "DeckChanged" }));

    // Missing card in a batch leaves the deck completely untouched.
    const secondPrint = fingerprint(repository.get(id)?.entries ?? []);
    const missing = await decks.applyChanges(jack, {
      deckId: id,
      fingerprint: secondPrint,
      changes: [
        { oracleId: "duress", board: "main", quantity: 0 },
        { oracleId: "no-such-card", board: "main", quantity: 1 },
      ],
    });
    expect(missing).toEqual(err({ kind: "CardNotFound" }));
    expect(repository.get(id)?.entries.find((e) => e.oracleId === "duress")?.quantity).toBe(3);
  });

  it("moves a card to the maybeboard and back, adding up copies (design doc 32)", async () => {
    const id = await newDeck();
    await decks.setEntry(jack, { deckId: id, oracleId: "bolt", board: "main", quantity: 3 });
    await decks.setEntry(jack, { deckId: id, oracleId: "bolt", board: "maybe", quantity: 1 });
    await decks.setEntry(jack, {
      deckId: id,
      oracleId: "bolt",
      board: "main",
      quantity: 3,
      printingId: samplePrintingId("bolt-m11"),
      finish: "foil",
    });
    expect(
      await decks.moveEntry(jack, { deckId: id, oracleId: "bolt", from: "main", to: "maybe" }),
    ).toEqual({ ok: true, value: undefined });
    // Four copies on the maybeboard, keeping the moved line's pinned printing (invariant 3).
    expect(repository.get(id)?.entries).toEqual([
      {
        oracleId: "bolt",
        board: "maybe",
        quantity: 4,
        printingId: samplePrintingId("bolt-m11"),
        finish: "foil",
        heading: null,
        note: null,
      },
    ]);
    await decks.moveEntry(jack, { deckId: id, oracleId: "bolt", from: "maybe", to: "main" });
    expect(repository.get(id)?.entries.map((entry) => entry.board)).toEqual(["main"]);
  });

  it("refuses to move a missing line, a commander, or another player's deck", async () => {
    const id = await newDeck();
    await decks.setEntry(jack, { deckId: id, oracleId: "ring", board: "commander", quantity: 1 });
    const move = (from: "main" | "commander", to: "maybe" | "commander") =>
      decks.moveEntry(jack, { deckId: id, oracleId: "ring", from, to });
    expect(await move("main", "maybe")).toEqual(err({ kind: "EntryNotFound" }));
    expect(await move("commander", "maybe")).toEqual(err({ kind: "CommanderMove" }));
    expect(
      await decks.moveEntry(mallory, {
        deckId: id,
        oracleId: "ring",
        from: "commander",
        to: "maybe",
      }),
    ).toEqual(err({ kind: "DeckNotFound" }));
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
        {
          oracleId: "bolt",
          board: "main",
          quantity: 4,
          printingId: "bolt-m11",
          finish: "nonfoil",
          heading: null,
          note: null,
        },
        {
          oracleId: "delver",
          board: "main",
          quantity: 1,
          printingId: "delver-1",
          finish: "nonfoil",
          heading: null,
          note: null,
        },
        {
          oracleId: "duress",
          board: "side",
          quantity: 2,
          printingId: "duress-1",
          finish: "nonfoil",
          heading: null,
          note: null,
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
      {
        oracleId: "bolt",
        board: "main",
        quantity: 3,
        printingId: null,
        finish: null,
        heading: null,
        note: null,
      },
      // A card new to the deck gets your most special copy (rule 10).
      {
        oracleId: "ring",
        board: "side",
        quantity: 1,
        printingId: "ring-foil",
        finish: "foil",
        heading: null,
        note: null,
      },
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
        heading: null,
        note: null,
      },
      {
        oracleId: "bolt",
        board: "main",
        quantity: 1,
        printingId: "bolt-m11",
        finish: "nonfoil",
        heading: null,
        note: null,
      },
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

describe("headings (design doc 34)", () => {
  async function deckWithCards() {
    const id = await newDeck();
    for (const oracleId of ["bolt", "duress", "ring"]) {
      await decks.setEntry(jack, { deckId: id, oracleId, board: "main", quantity: 1 });
    }
    return id;
  }
  const headingOf = (id: DeckId, oracleId: string) =>
    repository.get(id)?.entries.find((entry) => entry.oracleId === oracleId)?.heading;
  const setHeading = (id: DeckId, oracleId: string, heading: string | null) =>
    decks.setEntryHeading(jack, { deckId: id, oracleId, board: "main", heading });

  it("gives a card a heading, a new one going last, and clears it", async () => {
    const id = await deckWithCards();
    expect(await setHeading(id, "bolt", "  Removal ")).toEqual({ ok: true, value: undefined });
    await setHeading(id, "ring", "Ramp");
    expect(headingOf(id, "bolt")).toBe("Removal");
    expect(repository.get(id)?.headings).toEqual(["Removal", "Ramp"]);

    await setHeading(id, "bolt", null);
    expect(headingOf(id, "bolt")).toBeNull();
    // No card is under Removal any more, so it's gone from the order.
    expect(repository.get(id)?.headings).toEqual(["Ramp"]);
  });

  it("refuses a heading that's a board, a type or not a word, and a missing card", async () => {
    const id = await deckWithCards();
    for (const bad of ["Sideboard", "Creatures", "2-drops", "", "x".repeat(41)]) {
      expect(await setHeading(id, "bolt", bad)).toEqual(
        err({ kind: "HeadingInvalid", maximum: 40 }),
      );
    }
    expect(
      await decks.setEntryHeading(jack, {
        deckId: id,
        oracleId: "bolt",
        board: "side",
        heading: "Ramp",
      }),
    ).toEqual(err({ kind: "EntryNotFound" }));
    expect(
      await decks.setEntryHeading(mallory, {
        deckId: id,
        oracleId: "bolt",
        board: "main",
        heading: "Ramp",
      }),
    ).toEqual(err({ kind: "DeckNotFound" }));
  });

  it("renames, merges and clears a heading on every card", async () => {
    const id = await deckWithCards();
    await setHeading(id, "bolt", "Removal");
    await setHeading(id, "duress", "Discard");
    await setHeading(id, "ring", "Ramp");

    await decks.renameHeading(jack, { deckId: id, from: "Removal", to: "Interaction" });
    expect(repository.get(id)?.headings).toEqual(["Interaction", "Discard", "Ramp"]);
    await decks.renameHeading(jack, { deckId: id, from: "Discard", to: "Interaction" });
    expect(headingOf(id, "duress")).toBe("Interaction");
    expect(repository.get(id)?.headings).toEqual(["Interaction", "Ramp"]);
    await decks.renameHeading(jack, { deckId: id, from: "Ramp", to: null });
    expect(headingOf(id, "ring")).toBeNull();
    expect(await decks.renameHeading(jack, { deckId: id, from: "Ramp", to: "X" })).toEqual(
      err({ kind: "HeadingNotFound" }),
    );
  });

  it("orders headings only when every one is named once", async () => {
    const id = await deckWithCards();
    await setHeading(id, "bolt", "Removal");
    await setHeading(id, "ring", "Ramp");
    expect(await decks.orderHeadings(jack, { deckId: id, order: ["Ramp", "Removal"] })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(repository.get(id)?.headings).toEqual(["Ramp", "Removal"]);
    for (const order of [["Ramp"], ["Ramp", "Ramp"], ["Ramp", "Removal", "Lands"]]) {
      expect(await decks.orderHeadings(jack, { deckId: id, order })).toEqual(
        err({ kind: "HeadingOrderInvalid" }),
      );
    }
  });

  it("keeps a card's heading through the maybeboard and back", async () => {
    const id = await deckWithCards();
    await setHeading(id, "bolt", "Removal");
    await decks.moveEntry(jack, { deckId: id, oracleId: "bolt", from: "main", to: "maybe" });
    expect(repository.get(id)?.headings).toEqual(["Removal"]);
    await decks.moveEntry(jack, { deckId: id, oracleId: "bolt", from: "maybe", to: "main" });
    expect(headingOf(id, "bolt")).toBe("Removal");
  });

  it("imports headings from a pasted list and switches a deck without any to them", async () => {
    const id = await newDeck();
    await decks.importList(jack, {
      deckId: id,
      text: "Removal (4)\n4 Lightning Bolt\n\nLands (1)\n1 Sol Ring",
    });
    const deck = repository.get(id);
    expect(deck?.grouping).toBe("custom");
    expect(deck?.headings).toEqual(["Removal"]);
    expect(headingOf(id, "ring")).toBeNull();
  });

  it("replaceList keeps headings when the text has none, and sets them when it has some", async () => {
    const id = await deckWithCards();
    expect(repository.get(id)?.grouping).toBe("type");
    await setHeading(id, "bolt", "Removal");
    await setHeading(id, "ring", "Ramp");
    const current = () => fingerprint(repository.get(id)?.entries ?? []);

    await decks.replaceList(jack, {
      deckId: id,
      text: "1 Lightning Bolt\n1 Sol Ring",
      fingerprint: current(),
    });
    expect(headingOf(id, "bolt")).toBe("Removal");
    expect(repository.get(id)?.headings).toEqual(["Removal", "Ramp"]);

    await decks.replaceList(jack, {
      deckId: id,
      text: "Ramp (1)\n1 Sol Ring\n\nDeck\n1 Lightning Bolt",
      fingerprint: current(),
    });
    expect(headingOf(id, "bolt")).toBeNull();
    expect(repository.get(id)?.headings).toEqual(["Ramp"]);
  });

  it("switches a deck without headings to them when its text gets some", async () => {
    const id = await deckWithCards();
    await decks.replaceList(jack, {
      deckId: id,
      text: "Ramp (1)\n1 Sol Ring",
      fingerprint: fingerprint(repository.get(id)?.entries ?? []),
    });
    expect(repository.get(id)?.grouping).toBe("custom");
  });

  it("switches a deck's grouping", async () => {
    const id = await newDeck();
    await decks.updateDeck(jack, { deckId: id, grouping: "custom" });
    expect(repository.get(id)?.grouping).toBe("custom");
  });
});

describe("line notes (design doc 41)", () => {
  it("sets, updates, preserves across moves/quantity updates, and clears notes", async () => {
    const created = await decks.createDeck(jack, { name: "Red", format: "commander" });
    if (!created.ok) throw new Error("failed");
    const id = created.value;

    await decks.setEntry(jack, {
      deckId: id,
      oracleId: "bolt",
      board: "main",
      quantity: 1,
      note: "  Cheap  removal ",
    });
    expect(repository.get(id)?.entries[0]?.note).toBe("Cheap removal");

    // Moving to maybeboard and back preserves the note
    await decks.moveEntry(jack, { deckId: id, oracleId: "bolt", from: "main", to: "maybe" });
    await decks.moveEntry(jack, { deckId: id, oracleId: "bolt", from: "maybe", to: "main" });
    expect(repository.get(id)?.entries[0]?.note).toBe("Cheap removal");

    // setEntryNote updates and clears it
    expect(
      await decks.setEntryNote(jack, {
        deckId: id,
        oracleId: "bolt",
        board: "main",
        note: "Kills mana dorks",
      }),
    ).toEqual({ ok: true, value: undefined });
    expect(repository.get(id)?.entries[0]?.note).toBe("Kills mana dorks");

    await decks.setEntryNote(jack, { deckId: id, oracleId: "bolt", board: "main", note: null });
    expect(repository.get(id)?.entries[0]?.note).toBeNull();
  });

  it("rejects empty/overlong notes and checks ownership & entry existence", async () => {
    const created = await decks.createDeck(jack, { name: "Red", format: "commander" });
    if (!created.ok) throw new Error("failed");
    const id = created.value;

    expect(
      await decks.setEntryNote(jack, { deckId: id, oracleId: "bolt", board: "main", note: "  " }),
    ).toEqual(err({ kind: "NoteInvalid", maximum: MAX_NOTE_LENGTH }));
    expect(
      await decks.setEntryNote(jack, {
        deckId: id,
        oracleId: "bolt",
        board: "main",
        note: "a".repeat(MAX_NOTE_LENGTH + 1),
      }),
    ).toEqual(err({ kind: "NoteInvalid", maximum: MAX_NOTE_LENGTH }));
    expect(
      await decks.setEntryNote(jack, {
        deckId: id,
        oracleId: "bolt",
        board: "main",
        note: "Valid",
      }),
    ).toEqual(err({ kind: "EntryNotFound" }));

    await decks.setEntry(jack, { deckId: id, oracleId: "bolt", board: "main", quantity: 1 });
    expect(
      await decks.setEntryNote(mallory, {
        deckId: id,
        oracleId: "bolt",
        board: "main",
        note: "Sneaky",
      }),
    ).toEqual(err({ kind: "DeckNotFound" }));
  });

  it("applyChanges sets, preserves, and clears notes safely", async () => {
    const created = await decks.createDeck(jack, { name: "Red", format: "commander" });
    if (!created.ok) throw new Error("failed");
    const id = created.value;
    await decks.setEntry(jack, {
      deckId: id,
      oracleId: "bolt",
      board: "main",
      quantity: 1,
      note: "Keep this",
    });
    const fp = fingerprint(repository.get(id)?.entries ?? []);
    const applied = await decks.applyChanges(jack, {
      deckId: id,
      fingerprint: fp,
      changes: [
        { oracleId: "bolt", board: "main", quantity: 1 },
        { oracleId: "ring", board: "main", quantity: 1, note: "Turn-1 fast mana" },
      ],
    });
    expect(applied.ok).toBe(true);
    const entries = repository.get(id)?.entries ?? [];
    expect(entries.find((e) => e.oracleId === "bolt")?.note).toBe("Keep this");
    expect(entries.find((e) => e.oracleId === "ring")?.note).toBe("Turn-1 fast mana");
  });
});

describe("deck snapshots (design doc 41)", () => {
  it("saves, restores, and deletes snapshots for the owner only", async () => {
    const created = await decks.createDeck(jack, { name: "Burn", format: "commander" });
    if (!created.ok) throw new Error("failed");
    const id = created.value;
    await decks.setEntry(jack, {
      deckId: id,
      oracleId: "bolt",
      board: "main",
      quantity: 1,
      note: "Core spell",
    });

    const saved = await decks.saveSnapshot(jack, { deckId: id, label: "  Before   cuts  " });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(repository.snapshotsOf(id)[0]?.label).toBe("Before cuts");

    // Modify deck after saving snapshot
    await decks.setEntry(jack, { deckId: id, oracleId: "bolt", board: "main", quantity: 0 });
    await decks.setEntry(jack, { deckId: id, oracleId: "ring", board: "main", quantity: 1 });

    // Stale fingerprint blocks restore
    expect(
      await decks.restoreSnapshot(jack, {
        deckId: id,
        snapshotId: saved.value,
        fingerprint: "stale",
      }),
    ).toEqual(err({ kind: "DeckChanged" }));

    // Restoring recovers bolt + note and leaves snapshot intact
    const currentFp = fingerprint(repository.get(id)?.entries ?? []);
    const restored = await decks.restoreSnapshot(jack, {
      deckId: id,
      snapshotId: saved.value,
      fingerprint: currentFp,
    });
    expect(restored.ok).toBe(true);
    expect(repository.get(id)?.entries).toHaveLength(1);
    expect(repository.get(id)?.entries[0]).toMatchObject({
      oracleId: "bolt",
      quantity: 1,
      note: "Core spell",
    });
    expect(repository.snapshotsOf(id)).toHaveLength(1);

    // Other player cannot save, restore, or delete
    expect(await decks.saveSnapshot(mallory, { deckId: id, label: "Steal" })).toEqual(
      err({ kind: "DeckNotFound" }),
    );
    expect(await decks.deleteSnapshot(mallory, { deckId: id, snapshotId: saved.value })).toEqual(
      err({ kind: "DeckNotFound" }),
    );

    expect(await decks.deleteSnapshot(jack, { deckId: id, snapshotId: saved.value })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(repository.snapshotsOf(id)).toHaveLength(0);
    expect(
      await decks.restoreSnapshot(jack, { deckId: id, snapshotId: SnapshotId.of(999) }),
    ).toEqual(err({ kind: "SnapshotNotFound" }));
  });

  it("enforces label rules and snapshot limit per deck", async () => {
    const created = await decks.createDeck(jack, { name: "Cap", format: "casual" });
    if (!created.ok) throw new Error("failed");
    const id = created.value;

    expect(await decks.saveSnapshot(jack, { deckId: id, label: "  " })).toEqual(
      err({ kind: "SnapshotLabelInvalid", maximum: MAX_SNAPSHOT_LABEL_LENGTH }),
    );
    for (let i = 0; i < MAX_SNAPSHOTS_PER_DECK; i++) {
      const okSave = await decks.saveSnapshot(jack, { deckId: id, label: `v${i + 1}` });
      expect(okSave.ok).toBe(true);
    }
    expect(await decks.saveSnapshot(jack, { deckId: id, label: "overflow" })).toEqual(
      err({ kind: "TooManySnapshots", maximum: MAX_SNAPSHOTS_PER_DECK }),
    );
  });
});

describe("copying a shared or public deck (design doc 48)", () => {
  it("copies format, bracket, grouping, headings, and entries while clearing printings and notes", async () => {
    const created = await decks.createDeck(jack, { name: "Beza Control", format: "commander" });
    if (!created.ok) throw new Error("failed");
    const sourceId = created.value;
    await decks.updateDeck(jack, {
      deckId: sourceId,
      name: "Beza Control",
      format: "commander",
      targetBracket: 3,
      grouping: "custom",
    });
    await decks.setEntry(jack, {
      deckId: sourceId,
      oracleId: "ring",
      board: "main",
      quantity: 1,
      note: "My special note",
    });
    await decks.choosePrinting(jack, {
      deckId: sourceId,
      oracleId: "ring",
      board: "main",
      pinned: { printingId: samplePrintingId("ring-c21"), finish: "etched" },
    });
    await decks.setEntryHeading(jack, {
      deckId: sourceId,
      oracleId: "ring",
      board: "main",
      heading: "Ramp",
    });

    // Private deck cannot be copied by another player.
    expect(await decks.copyDeck(mallory, { kind: "deck", deckId: sourceId })).toEqual(
      err({ kind: "DeckNotFound" }),
    );

    // Shared deck can be copied.
    repository.setSharing(sourceId, { visibility: "shared" });
    const copied = await decks.copyDeck(mallory, { kind: "deck", deckId: sourceId });
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;

    const copy = repository.get(copied.value);
    expect(copy).toMatchObject({
      ownerId: mallory.userId,
      name: "Beza Control (copy)",
      format: "commander",
      targetBracket: 3,
      grouping: "custom",
      headings: ["Ramp"],
      usesRealCards: true,
    });
    expect(copy?.entries).toEqual([
      {
        oracleId: "ring",
        board: "main",
        quantity: 1,
        printingId: null,
        finish: null,
        heading: "Ramp",
        note: null,
      },
    ]);
  });

  it("copies a private deck via its public token and enforces MAX_DECKS", async () => {
    const created = await decks.createDeck(jack, { name: "Secret Brew", format: "modern" });
    if (!created.ok) throw new Error("failed");
    repository.setSharing(created.value, { publicToken: "abcDEF0123456789_-abcd" });

    const copied = await decks.copyDeck(mallory, {
      kind: "publicToken",
      token: "abcDEF0123456789_-abcd",
    });
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(repository.get(copied.value)?.name).toBe("Secret Brew (copy)");

    expect(
      await decks.copyDeck(mallory, { kind: "publicToken", token: "missing-token-123456" }),
    ).toEqual(err({ kind: "DeckNotFound" }));

    for (let i = 1; i < MAX_DECKS; i++) {
      await decks.createDeck(mallory, { name: `Deck ${i}`, format: "casual" });
    }
    expect(
      await decks.copyDeck(mallory, { kind: "publicToken", token: "abcDEF0123456789_-abcd" }),
    ).toEqual(err({ kind: "TooManyDecks", maximum: MAX_DECKS }));
  });
});
