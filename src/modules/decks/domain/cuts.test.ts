import { describe, expect, it } from "vitest";
import { rankCuts, type CutLine, type CutReason } from "./cuts";

// Cards to cut (design doc 32, section 3 and invariants 4-5).

const line = (name: string, overrides: Partial<CutLine> = {}): CutLine => ({
  oracleId: name,
  name,
  board: "main",
  quantity: 1,
  owned: 1,
  manaValue: 2,
  typeLine: "Creature — Bear",
  text: "",
  keywords: [],
  rarity: "common",
  priceCents: 10,
  isGameChanger: false,
  ...overrides,
});

/** A token commander: "tokens" becomes a theme of the deck. */
const commander = line("Rhys the Exiled Token Lord", {
  board: "commander",
  typeLine: "Legendary Creature — Elf",
  text: "Whenever you cast a spell, create a 1/1 green Elf creature token.",
  manaValue: 3,
});
const tokenMaker = (name: string) =>
  line(name, { text: "When this enters, create two 1/1 Soldier creature tokens." });
const ramp = (name: string) =>
  line(name, {
    typeLine: "Artifact",
    text: "{T}: Add {C}.",
    manaValue: 2,
    producedMana: ["C"],
  });

const kinds = (reasons: readonly CutReason[]) => reasons.map((reason) => reason.kind);
const names = (lines: readonly CutLine[], targetBracket: 1 | 2 | 3 | 4 | 5 | null = null) =>
  rankCuts(lines, { format: "commander", targetBracket }).map((cut) => cut.name);

describe("rankCuts", () => {
  it("puts a card that fits nothing first, and says so", () => {
    const cuts = rankCuts([commander, tokenMaker("Raise the Alarm"), line("Grizzly Bears")], {
      format: "commander",
      targetBracket: null,
    });
    expect(cuts.map((cut) => cut.name)).toEqual(["Grizzly Bears", "Raise the Alarm"]);
    expect(kinds(cuts[0].reasons)).toEqual(["noFit"]);
    expect(cuts[1].reasons[0]).toMatchObject({ kind: "fits" });
  });

  it("keeps a card whose role the deck is short of, and offers one of too many", () => {
    // 1 ramp card against a target of 10: needed. 13 against 10: one of them can go.
    const few = rankCuts([commander, ramp("Mind Stone"), line("Grizzly Bears")], {
      format: "commander",
      targetBracket: null,
    });
    expect(few.map((cut) => cut.name)).toEqual(["Grizzly Bears", "Mind Stone"]);
    expect(few[1].reasons).toContainEqual({
      kind: "neededRole",
      tag: "ramp",
      count: 1,
      target: 10,
    });

    const many = Array.from({ length: 13 }, (_, index) => ramp(`Rock ${index + 1}`));
    const cuts = rankCuts([commander, ...many], { format: "commander", targetBracket: null });
    expect(cuts[0].reasons).toContainEqual({
      kind: "surplusRole",
      tag: "ramp",
      count: 13,
      target: 10,
    });
  });

  it("marks expensive cards when the curve is high", () => {
    const heavy = [commander, line("Big One", { manaValue: 7 }), line("Big Two", { manaValue: 6 })];
    const cuts = rankCuts(heavy, { format: "commander", targetBracket: null });
    expect(cuts[0]).toMatchObject({ name: "Big One" });
    expect(kinds(cuts[0].reasons)).toContain("topHeavy");
  });

  it("cuts a Game Changer first when the deck is over its target bracket", () => {
    const changer = line("Rhystic Study", { isGameChanger: true });
    expect(names([commander, line("Grizzly Bears"), changer], 2)[0]).toBe("Rhystic Study");
    // Within the target (bracket 3 allows three), it's an ordinary card.
    expect(names([commander, line("Grizzly Bears"), changer], 3)[0]).toBe("Grizzly Bears");
  });

  it("counts not owning a card against it", () => {
    const cuts = rankCuts([commander, line("Owned"), line("Short", { owned: 0, quantity: 1 })], {
      format: "commander",
      targetBracket: null,
    });
    expect(cuts[0]).toMatchObject({ name: "Short" });
    expect(cuts[0].reasons).toContainEqual({ kind: "notOwned", short: 1 });
  });

  it("never lists lands, commanders, or the sideboard and maybeboard (invariant 4)", () => {
    const lines = [
      commander,
      line("Forest", { typeLine: "Basic Land — Forest" }),
      line("Side Bear", { board: "side" }),
      line("Maybe Bear", { board: "maybe" }),
      line("Main Bear"),
    ];
    expect(names(lines)).toEqual(["Main Bear"]);
  });

  it("orders equal scores by name, the same every time (invariant 5)", () => {
    const lines = [commander, line("Zebra"), line("Aardvark"), line("Moose")];
    expect(names(lines)).toEqual(["Aardvark", "Moose", "Zebra"]);
    expect(names([...lines].reverse())).toEqual(["Aardvark", "Moose", "Zebra"]);
  });

  it("gives a keep bonus for high-synergy or high-inclusion EDHREC cards", () => {
    const staple = line("Commander Staple", {
      edhrec: { inclusionRate: 0.72, synergy: 0.45 },
    });
    const chaff = line("Random Bear");
    const cuts = rankCuts([commander, staple, chaff], {
      format: "commander",
      targetBracket: null,
    });
    expect(cuts.map((cut) => cut.name)).toEqual(["Random Bear", "Commander Staple"]);
    expect(cuts[1].reasons).toContainEqual({
      kind: "edhrec",
      inclusionPct: 72,
      synergyPct: 45,
    });
  });

  it("gives a keep bonus for cards with high embedSim to the deck", () => {
    const synergistic = line("Synergy Piece", { embedSim: 0.82 });
    const offPlan = line("Random Bear", { embedSim: 0.45 });
    const cuts = rankCuts([commander, synergistic, offPlan], {
      format: "commander",
      targetBracket: null,
    });
    expect(cuts.map((cut) => cut.name)).toEqual(["Random Bear", "Synergy Piece"]);
    expect(cuts[1].reasons).toContainEqual({ kind: "embedSim", similarityPct: 82 });
  });
});
