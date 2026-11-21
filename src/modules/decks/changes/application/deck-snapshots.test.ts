import { testActor } from "@/modules/accounts/testing/actors";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { err } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { fingerprint } from "@/modules/decks/core/client";
import { makeDecks } from "@/modules/decks/core";
import { inMemoryCardLookup, inMemoryDeckRepository } from "@/modules/decks/core/testing/fakes";
import { inMemorySnapshotRepository } from "../testing/fakes";
import { MAX_SNAPSHOT_LABEL_LENGTH, MAX_SNAPSHOTS_PER_DECK, SnapshotId } from "../domain/snapshots";
import { makeDeckSnapshots } from "./deck-snapshots";

const jack: Actor = testActor({ name: "jack" });
const mallory: Actor = testActor({ name: "mallory" });

let repository: ReturnType<typeof inMemoryDeckRepository>;
let snapshotRepository: ReturnType<typeof inMemorySnapshotRepository>;
let decks: ReturnType<typeof makeDecks>;
let snapshots: ReturnType<typeof makeDeckSnapshots>;

beforeEach(() => {
  repository = inMemoryDeckRepository();
  snapshotRepository = inMemorySnapshotRepository();
  const cards = inMemoryCardLookup([
    { oracleId: "bolt", name: "Lightning Bolt", printingId: "bolt-m11" },
    { oracleId: "ring", name: "Sol Ring", printingId: "ring-foil", finish: "foil" },
  ]);
  const unitOfWork = inMemoryUnitOfWork({
    decks: repository,
    cards,
    snapshots: snapshotRepository,
  });
  const clock = fixedClock("2026-09-27T12:00:00Z");
  decks = makeDecks({ unitOfWork, clock });
  snapshots = makeDeckSnapshots({ unitOfWork, clock });
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

    const saved = await snapshots.saveSnapshot(jack, { deckId: id, label: "  Before   cuts  " });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(snapshotRepository.snapshotsOf(id)[0]?.label).toBe("Before cuts");

    // Modify deck after saving snapshot
    await decks.setEntry(jack, { deckId: id, oracleId: "bolt", board: "main", quantity: 0 });
    await decks.setEntry(jack, { deckId: id, oracleId: "ring", board: "main", quantity: 1 });

    // Stale fingerprint blocks restore
    expect(
      await snapshots.restoreSnapshot(jack, {
        deckId: id,
        snapshotId: saved.value,
        fingerprint: "stale",
      }),
    ).toEqual(err({ kind: "DeckChanged" }));

    // Restoring recovers bolt + note and leaves snapshot intact
    const currentFp = fingerprint(repository.get(id)?.entries ?? []);
    const restored = await snapshots.restoreSnapshot(jack, {
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
    expect(snapshotRepository.snapshotsOf(id)).toHaveLength(1);

    // Other player cannot save, restore, or delete
    expect(await snapshots.saveSnapshot(mallory, { deckId: id, label: "Steal" })).toEqual(
      err({ kind: "DeckNotFound" }),
    );
    expect(
      await snapshots.deleteSnapshot(mallory, { deckId: id, snapshotId: saved.value }),
    ).toEqual(err({ kind: "DeckNotFound" }));

    expect(await snapshots.deleteSnapshot(jack, { deckId: id, snapshotId: saved.value })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(snapshotRepository.snapshotsOf(id)).toHaveLength(0);
    expect(
      await snapshots.restoreSnapshot(jack, { deckId: id, snapshotId: SnapshotId.of(999) }),
    ).toEqual(err({ kind: "SnapshotNotFound" }));
  });

  it("enforces label rules and snapshot limit per deck", async () => {
    const created = await decks.createDeck(jack, { name: "Cap", format: "casual" });
    if (!created.ok) throw new Error("failed");
    const id = created.value;

    expect(await snapshots.saveSnapshot(jack, { deckId: id, label: "  " })).toEqual(
      err({ kind: "SnapshotLabelInvalid", maximum: MAX_SNAPSHOT_LABEL_LENGTH }),
    );
    for (let i = 0; i < MAX_SNAPSHOTS_PER_DECK; i++) {
      const okSave = await snapshots.saveSnapshot(jack, { deckId: id, label: `v${i + 1}` });
      expect(okSave.ok).toBe(true);
    }
    expect(await snapshots.saveSnapshot(jack, { deckId: id, label: "overflow" })).toEqual(
      err({ kind: "TooManySnapshots", maximum: MAX_SNAPSHOTS_PER_DECK }),
    );
  });
});
