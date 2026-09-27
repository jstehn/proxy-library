import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { err, UserId } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { DeckId, MAX_DECKS } from "../domain/deck";
import { inMemoryCardLookup, inMemoryDeckRepository } from "../testing/fakes";
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
