import { describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { ok, UserId } from "@/shared/kernel";
import { manualClock } from "@/shared/kernel/testing";
import type { DeckChange, DeckChangePreview } from "../domain/preview";
import { makeDeckPreviews, PREVIEW_TTL_MS, type DeckPreviewDependencies } from "./deck-previews";
import type { PreviewRecord, PreviewRepository } from "./ports";

const actor = { userId: UserId.of("1") } as Actor;
const other = { userId: UserId.of("2") } as Actor;

function memoryPreviews(): PreviewRepository & { records: Map<string, PreviewRecord> } {
  const records = new Map<string, PreviewRecord>();
  return {
    records,
    async store(record) {
      records.set(record.id, record);
    },
    async find(id, userId, now) {
      const record = records.get(id);
      return record && record.userId === userId && record.expiresAt > now ? record : null;
    },
    async delete(id) {
      records.delete(id);
    },
    async prune(now) {
      for (const [id, record] of records) if (record.expiresAt <= now) records.delete(id);
    },
  };
}

function fakePreview(changes: readonly DeckChange[]): DeckChangePreview {
  return {
    deck: { id: 5, name: "Deck", format: "commander" },
    fingerprint: "fp-1",
    changes: changes.map((change) => ({
      name: change.oracleId.replace("oracle-", ""),
      board: change.board,
      beforeQuantity: 1,
      afterQuantity: change.quantity,
    })),
  } as unknown as DeckChangePreview;
}

function setup(overrides: Partial<DeckPreviewDependencies> = {}) {
  const previews = memoryPreviews();
  const clock = manualClock("2026-01-01T00:00:00Z");
  const applied: unknown[] = [];
  let counter = 0;
  const dependencies: DeckPreviewDependencies = {
    previews,
    clock,
    newPreviewId: () => `preview-${++counter}`,
    findCards: async (names) =>
      new Map(names.filter((name) => name !== "Nope").map((name) => [name, `oracle-${name}`])),
    deckView: async () =>
      ({
        lines: [
          {
            oracleId: "oracle-Sol Ring",
            name: "Sol Ring",
            board: "main",
            quantity: 1,
            pinned: true,
          },
        ],
      }) as never,
    changePreview: async (_userId, _deckId, changes) => fakePreview(changes),
    castCurves: async () => null,
    profile: async () => null,
    applyChanges: async (_actor, input) => {
      applied.push(input);
      return ok({ cards: 99, fingerprint: "fp-2" });
    },
    ...overrides,
  };
  return { capability: makeDeckPreviews(dependencies), previews, clock, applied };
}

const someCurves = {
  runs: 2000,
  marginPct: 2.2,
  onTheDraw: false,
  cards: [],
};

describe("previewChanges cast curves (design doc 72)", () => {
  const changes = [{ card: "Sol Ring", board: "main" as const, quantity: 0 }];

  it("returns the curves the port made, for the dry-run changes", async () => {
    const seen: unknown[] = [];
    const { capability } = setup({
      castCurves: async (_userId, _deckId, dryRun) => {
        seen.push(dryRun);
        return someCurves;
      },
    });
    const result = await capability.previewChanges(actor, { deckId: 5, changes });
    expect(result.ok && result.value.castCurves).toEqual(someCurves);
    expect(seen).toEqual([[{ oracleId: "oracle-Sol Ring", board: "main", quantity: 0 }]]);
  });

  it("skips the simulation when curves are switched off", async () => {
    let calls = 0;
    const { capability } = setup({
      castCurves: async () => {
        calls += 1;
        return someCurves;
      },
    });
    const result = await capability.previewChanges(actor, { deckId: 5, changes, curves: false });
    expect(result.ok && result.value.castCurves).toBeNull();
    expect(calls).toBe(0);
  });

  it("still previews and stores when the simulation throws (invariant 5)", async () => {
    const { capability, previews } = setup({
      castCurves: async () => {
        throw new Error("simulation failed");
      },
    });
    const result = await capability.previewChanges(actor, { deckId: 5, changes });
    expect(result.ok && result.value.castCurves).toBeNull();
    expect(previews.records.size).toBe(1);
  });
});

describe("previewChanges", () => {
  it("stores the resolved changes under a new id, for 30 minutes", async () => {
    const { capability, previews, clock } = setup();
    const result = await capability.previewChanges(actor, {
      deckId: 5,
      changes: [{ card: "Sol Ring", board: "main", quantity: 0 }],
    });
    expect(result.ok && result.value.previewId).toBe("preview-1");
    expect(previews.records.get("preview-1")).toMatchObject({
      deckId: 5,
      fingerprint: "fp-1",
      changes: [{ oracleId: "oracle-Sol Ring", board: "main", quantity: 0 }],
      expiresAt: new Date(clock.now().getTime() + PREVIEW_TTL_MS),
    });
  });

  it("names every card the catalog lacks and stores nothing", async () => {
    const { capability, previews } = setup();
    const result = await capability.previewChanges(actor, {
      deckId: 5,
      changes: [
        { card: "Nope", board: "main", quantity: 1 },
        { card: "Sol Ring", board: "main", quantity: 1 },
      ],
    });
    expect(result).toEqual({ ok: false, error: { kind: "CardsNotFound", names: ["Nope"] } });
    expect(previews.records.size).toBe(0);
  });

  it("keeps a line's count when a change leaves the quantity out", async () => {
    const { capability, previews } = setup();
    await capability.previewChanges(actor, {
      deckId: 5,
      changes: [{ card: "Sol Ring", board: "main", note: "Ramp" }],
    });
    expect(previews.records.get("preview-1")?.changes[0]).toMatchObject({
      quantity: 1,
      note: "Ramp",
    });
  });

  it("refuses a count-less change to a line the deck doesn't have", async () => {
    const { capability } = setup();
    const result = await capability.previewChanges(actor, {
      deckId: 5,
      changes: [{ card: "Sol Ring", board: "side" }],
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "LineNotOnBoard", card: "Sol Ring", board: "side" },
    });
  });

  it("warns when a pinned card is cut", async () => {
    const { capability } = setup();
    const result = await capability.previewChanges(actor, {
      deckId: 5,
      changes: [{ card: "Sol Ring", board: "main", quantity: 0 }],
    });
    expect(result.ok && result.value.warnings).toEqual([
      {
        kind: "KeyCardCut",
        card: "Sol Ring",
        board: "main",
        before: 1,
        after: 0,
        pinned: true,
        reason: null,
      },
    ]);
  });
});

describe("saveChanges", () => {
  it("applies the changes with the given fingerprint and reports the new one", async () => {
    const { capability, applied, previews } = setup();
    const result = await capability.saveChanges(actor, {
      deckId: 5,
      fingerprint: "fp-1",
      changes: [{ card: "Sol Ring", board: "main", quantity: 2 }],
    });
    expect(result.ok && result.value.fingerprint).toBe("fp-2");
    expect(applied).toEqual([
      {
        deckId: 5,
        fingerprint: "fp-1",
        changes: [{ oracleId: "oracle-Sol Ring", board: "main", quantity: 2 }],
      },
    ]);
    expect(previews.records.size).toBe(0);
  });
});

describe("applyPreview", () => {
  async function stored() {
    const context = setup();
    await context.capability.previewChanges(actor, {
      deckId: 5,
      changes: [{ card: "Sol Ring", board: "main", quantity: 2 }],
    });
    return context;
  }

  it("applies what the preview stored, then forgets it", async () => {
    const { capability, applied, previews } = await stored();
    const result = await capability.applyPreview(actor, { deckId: 5, previewId: "preview-1" });
    expect(result.ok && result.value.fingerprint).toBe("fp-2");
    expect(applied).toMatchObject([{ fingerprint: "fp-1" }]);
    expect(previews.records.size).toBe(0);
  });

  it("is expired after 30 minutes", async () => {
    const { capability, clock } = await stored();
    clock.advanceBy(PREVIEW_TTL_MS + 1);
    expect(await capability.applyPreview(actor, { deckId: 5, previewId: "preview-1" })).toEqual({
      ok: false,
      error: { kind: "PreviewExpired" },
    });
  });

  it("is not another player's, and not another deck's", async () => {
    const { capability } = await stored();
    const asOther = await capability.applyPreview(other, { deckId: 5, previewId: "preview-1" });
    const otherDeck = await capability.applyPreview(actor, { deckId: 6, previewId: "preview-1" });
    expect(asOther).toEqual({ ok: false, error: { kind: "PreviewExpired" } });
    expect(otherDeck).toEqual({ ok: false, error: { kind: "PreviewExpired" } });
  });
});
