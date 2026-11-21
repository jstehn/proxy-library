import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import { DeckId, type Deck, type DeckEntry } from "./deck";
import {
  checkHeading,
  headingMoved,
  MAX_HEADINGS,
  orderedHeadings,
  renamedHeading,
  tidyHeadings,
} from "./headings";

// A deck's own headings (design doc 34).

const entry = (oracleId: string, heading: string | null): DeckEntry => ({
  oracleId,
  board: "main",
  quantity: 1,
  printingId: null,
  finish: null,
  heading,
  note: null,
});
const deck = (entries: DeckEntry[], headings: string[] = []): Deck => ({
  id: DeckId.of(1),
  ownerId: UserId.of("jack"),
  name: "Test",
  format: "commander",
  usesRealCards: false,
  targetBracket: null,
  grouping: "custom",
  headings,
  entries,
});

describe("checkHeading", () => {
  it("trims and squeezes spaces", () => {
    expect(checkHeading("  Win   conditions ")).toEqual({ ok: true, value: "Win conditions" });
  });

  it("refuses what a list would read as something else", () => {
    for (const bad of ["", "Sideboard", "commander", "Lands", "Creatures", "1-drops", "// x"]) {
      expect(checkHeading(bad).ok).toBe(false);
    }
    expect(checkHeading("Élan (foreign)").ok).toBe(true);
  });
});

describe("tidyHeadings", () => {
  it("drops headings no card uses and puts new ones last, in the order of the cards", () => {
    const tidied = tidyHeadings(
      deck([entry("a", "Ramp"), entry("b", "Draw"), entry("c", "Removal")], ["Removal", "Old"]),
    );
    expect(tidied.headings).toEqual(["Removal", "Ramp", "Draw"]);
  });

  it("takes the heading off cards past the most a deck may have", () => {
    const many = Array.from({ length: MAX_HEADINGS + 1 }, (_, index) =>
      entry(`card-${index}`, `Heading ${index}`),
    );
    const tidied = tidyHeadings(deck(many));
    expect(tidied.headings).toHaveLength(MAX_HEADINGS);
    expect(tidied.entries.at(-1)?.heading).toBeNull();
  });
});

describe("renamedHeading and orderedHeadings", () => {
  const start = deck([entry("a", "Ramp"), entry("b", "Draw")], ["Ramp", "Draw"]);

  it("renames in place, merges into an existing heading, and clears", () => {
    const renamed = renamedHeading(start, "Ramp", "Mana");
    expect(renamed.ok && renamed.value.headings).toEqual(["Mana", "Draw"]);
    const merged = renamedHeading(start, "Ramp", "Draw");
    expect(merged.ok && merged.value.headings).toEqual(["Draw"]);
    expect(merged.ok && merged.value.entries.map((each) => each.heading)).toEqual(["Draw", "Draw"]);
    const cleared = renamedHeading(start, "Ramp", null);
    expect(cleared.ok && cleared.value.entries[0].heading).toBeNull();
    expect(renamedHeading(start, "Nope", "X")).toEqual({
      ok: false,
      error: { kind: "HeadingNotFound" },
    });
  });

  it("orders only a full list of the deck's headings", () => {
    expect(orderedHeadings(start, ["Draw", "Ramp"]).ok).toBe(true);
    expect(orderedHeadings(start, ["Draw"]).ok).toBe(false);
    expect(orderedHeadings(start, ["Draw", "Draw"]).ok).toBe(false);
  });

  it("moves a heading up or down, and not past either end", () => {
    expect(headingMoved(["A", "B", "C"], "B", "up")).toEqual(["B", "A", "C"]);
    expect(headingMoved(["A", "B", "C"], "B", "down")).toEqual(["A", "C", "B"]);
    expect(headingMoved(["A", "B"], "A", "up")).toEqual(["A", "B"]);
  });
});
