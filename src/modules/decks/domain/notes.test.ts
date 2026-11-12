import { describe, expect, it } from "vitest";
import type { PrintingId } from "@/modules/catalog";
import { err, ok, UserId } from "@/shared/kernel";
import { DeckId, movedEntry, replacedEntries, withEntry, type Deck } from "./deck";
import { checkNote, MAX_NOTE_LENGTH } from "./notes";

const sampleDeck = (): Deck => ({
  id: DeckId.of(1),
  ownerId: UserId.of("jack"),
  name: "Test",
  format: "commander",
  usesRealCards: true,
  targetBracket: null,
  grouping: "type",
  headings: [],
  entries: [
    {
      oracleId: "bolt",
      board: "main",
      quantity: 1,
      printingId: null,
      finish: null,
      heading: null,
      note: "Cheap early removal",
    },
  ],
});

describe("checkNote", () => {
  it("trims and collapses whitespace", () => {
    expect(checkNote("  Combos   with\nDeadeye  ")).toEqual(ok("Combos with Deadeye"));
  });

  it("rejects empty or overlong notes", () => {
    expect(checkNote("   ")).toEqual(err({ kind: "NoteInvalid", maximum: MAX_NOTE_LENGTH }));
    expect(checkNote("a".repeat(MAX_NOTE_LENGTH))).toEqual(ok("a".repeat(MAX_NOTE_LENGTH)));
    expect(checkNote("a".repeat(MAX_NOTE_LENGTH + 1))).toEqual(
      err({ kind: "NoteInvalid", maximum: MAX_NOTE_LENGTH }),
    );
  });
});

describe("line notes across deck mutations", () => {
  it("withEntry preserves existing notes when omitted and updates or clears when given", () => {
    const bumped = withEntry(sampleDeck(), { oracleId: "bolt", board: "main", quantity: 2 });
    expect(bumped.entries[0]?.note).toBe("Cheap early removal");

    const updated = withEntry(bumped, {
      oracleId: "bolt",
      board: "main",
      quantity: 2,
      note: "Updated reason",
    });
    expect(updated.entries[0]?.note).toBe("Updated reason");

    const cleared = withEntry(updated, {
      oracleId: "bolt",
      board: "main",
      quantity: 1,
      note: null,
    });
    expect(cleared.entries[0]?.note).toBeNull();
  });

  it("movedEntry preserves notes to maybeboard and back", () => {
    const toMaybe = movedEntry(sampleDeck(), { oracleId: "bolt", from: "main", to: "maybe" });
    expect(toMaybe.ok).toBe(true);
    if (!toMaybe.ok) return;
    expect(toMaybe.value.entries[0]).toMatchObject({
      board: "maybe",
      note: "Cheap early removal",
    });

    const backToMain = movedEntry(toMaybe.value, { oracleId: "bolt", from: "maybe", to: "main" });
    expect(backToMain.ok).toBe(true);
    if (!backToMain.ok) return;
    expect(backToMain.value.entries[0]).toMatchObject({
      board: "main",
      note: "Cheap early removal",
    });
  });

  it("replacedEntries keeps existing notes on surviving cards", () => {
    const kept = replacedEntries(sampleDeck().entries, [
      {
        oracleId: "bolt",
        board: "main",
        quantity: 1,
        printingId: "p-bolt" as PrintingId,
        finish: "nonfoil",
        namesPrinting: false,
        finishMarker: null,
        heading: null,
      },
    ]);
    expect(kept[0]?.note).toBe("Cheap early removal");
  });
});
