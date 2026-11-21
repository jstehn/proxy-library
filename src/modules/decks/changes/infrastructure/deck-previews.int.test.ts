// The stored dry-run changes (design doc 40, P08) against real Postgres.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeDecks } from "@/modules/decks";
import { drizzleChangePreviewRepository } from "@/modules/decks/infrastructure";
import { UserId } from "@/shared/kernel";
import {
  actor,
  clock,
  close,
  db,
  resetPlayers,
  unitOfWork,
} from "../../../../../tests/integration/harness";

afterAll(close);
beforeEach(() => resetPlayers(["jack", "jill"]));

const decks = makeDecks({ unitOfWork, clock });
const previews = drizzleChangePreviewRepository(db);
const jack = actor("jack");

async function newDeck(): Promise<number> {
  const created = await decks.createDeck(jack, { name: "Previews", format: "commander" });
  if (!created.ok) throw new Error("deck not created");
  return created.value;
}

const record = (deckId: number, id: string, expiresAt: Date) => ({
  id,
  userId: UserId.of("jack"),
  deckId,
  fingerprint: "fp",
  changes: [{ oracleId: "o1", board: "main" as const, quantity: 2, note: null, tags: ["Ramp"] }],
  expiresAt,
});

describe("the change preview table", () => {
  it("returns what was stored, to its player only, until it expires", async () => {
    const deckId = await newDeck();
    const now = new Date("2026-01-01T12:00:00Z");
    await previews.store(record(deckId, "p1", new Date("2026-01-01T12:30:00Z")));

    expect(await previews.find("p1", UserId.of("jack"), now)).toMatchObject({
      deckId,
      fingerprint: "fp",
      changes: [{ oracleId: "o1", board: "main", quantity: 2, note: null, tags: ["Ramp"] }],
    });
    expect(await previews.find("p1", UserId.of("jill"), now)).toBeNull();
    expect(
      await previews.find("p1", UserId.of("jack"), new Date("2026-01-01T12:30:01Z")),
    ).toBeNull();
  });

  it("prunes the expired ones only, and deletes one on request", async () => {
    const deckId = await newDeck();
    await previews.store(record(deckId, "old", new Date("2026-01-01T00:00:00Z")));
    await previews.store(record(deckId, "new", new Date("2026-01-02T00:00:00Z")));
    await previews.prune(new Date("2026-01-01T12:00:00Z"));

    const early = new Date("2025-12-31T00:00:00Z");
    expect(await previews.find("old", UserId.of("jack"), early)).toBeNull();
    expect(await previews.find("new", UserId.of("jack"), early)).not.toBeNull();

    await previews.delete("new");
    expect(await previews.find("new", UserId.of("jack"), early)).toBeNull();
  });

  it("goes with its deck", async () => {
    const deckId = await newDeck();
    await previews.store(record(deckId, "gone", new Date("2026-01-02T00:00:00Z")));
    await decks.deleteDeck(jack, deckId as never);
    expect(
      await previews.find("gone", UserId.of("jack"), new Date("2026-01-01T00:00:00Z")),
    ).toBeNull();
  });
});
