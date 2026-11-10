import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { err, ok, UserId } from "@/shared/kernel";
import { inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { DeckId } from "../domain/deck";
import { inMemoryDeckRepository, inMemoryDeckTokens } from "../testing/fakes";
import { makeTokenChoices } from "./token-choices";

// Choosing a token's art, or leaving it out (design doc 25).

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

let deckTokens: ReturnType<typeof inMemoryDeckTokens>;
let chooseToken: ReturnType<typeof makeTokenChoices>;
let deckId: DeckId;

beforeEach(async () => {
  const decks = inMemoryDeckRepository();
  deckTokens = inMemoryDeckTokens([
    { tokenId: "goblin-m13", tokenOracleId: "goblin", madeBy: ["krenko"] },
    { tokenId: "goblin-dom", tokenOracleId: "goblin", madeBy: [] },
    { tokenId: "treasure-1", tokenOracleId: "treasure", madeBy: ["tithe"] },
  ]);
  chooseToken = makeTokenChoices({ unitOfWork: inMemoryUnitOfWork({ decks, deckTokens }) });
  deckId = await decks.create({
    ownerId: jack.userId,
    name: "Goblins",
    format: "casual",
    at: new Date(),
  });
  await decks.save(
    {
      id: deckId,
      ownerId: jack.userId,
      name: "Goblins",
      format: "casual",
      usesRealCards: false,
      targetBracket: null,
      entries: [{ oracleId: "krenko", board: "main", quantity: 1, printingId: null, finish: null }],
    },
    new Date(),
  );
});

describe("chooseToken", () => {
  it("saves any art of a token the deck makes, and whether it prints", async () => {
    const choice = { deckId, tokenOracleId: "goblin", tokenId: "goblin-dom", included: false };
    expect(await chooseToken(jack, choice)).toEqual(ok());
    expect(deckTokens.choicesOf(deckId)).toEqual([
      { tokenOracleId: "goblin", tokenId: "goblin-dom", included: false },
    ]);
  });

  it("goes back to the default art", async () => {
    await chooseToken(jack, {
      deckId,
      tokenOracleId: "goblin",
      tokenId: "goblin-dom",
      included: true,
    });
    await chooseToken(jack, { deckId, tokenOracleId: "goblin", tokenId: null, included: true });
    expect(deckTokens.choicesOf(deckId)).toEqual([
      { tokenOracleId: "goblin", tokenId: null, included: true },
    ]);
  });

  it("refuses someone else's deck", async () => {
    const choice = { deckId, tokenOracleId: "goblin", tokenId: null, included: true };
    expect(await chooseToken(mallory, choice)).toEqual(err({ kind: "DeckNotFound" }));
  });

  it("refuses a token none of the deck's cards make", async () => {
    const choice = { deckId, tokenOracleId: "treasure", tokenId: null, included: false };
    expect(await chooseToken(jack, choice)).toEqual(err({ kind: "TokenNotInDeck" }));
  });

  it("refuses art of another token, or art the catalog doesn't have", async () => {
    for (const tokenId of ["treasure-1", "nope"]) {
      const choice = { deckId, tokenOracleId: "goblin", tokenId, included: true };
      expect(await chooseToken(jack, choice)).toEqual(err({ kind: "NotThatToken" }));
    }
    expect(deckTokens.choicesOf(deckId)).toEqual([]);
  });
});
