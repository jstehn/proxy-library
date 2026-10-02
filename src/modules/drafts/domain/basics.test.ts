import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Color } from "@/modules/catalog";
import { seededRng, UserId } from "@/shared/kernel";
import { samplePacks, samplePrintingId } from "../testing/samples";
import {
  dealBasics,
  FREE_BASICS_CAP,
  freeBasicsFor,
  planBasicLands,
  takeOutBasics,
  type OwnedBasic,
} from "./basics";

const forest = (n: number) => ({
  printingId: samplePrintingId(`forest-${n}`),
  finish: "nonfoil" as const,
});
const players = ["alice", "bob", "carol"].map((id) => UserId.of(id));

describe("takeOutBasics (rule 15)", () => {
  it("takes the basics out of every pack and keeps everything else in order", () => {
    // Slot 0 of every pack is the "basic" here.
    const { packs, basics } = takeOutBasics(samplePacks(2, 3, 3), (id) => id.endsWith("c0"));
    expect(basics).toHaveLength(6);
    expect(packs.flat().map((pack) => pack.cards.map((card) => card.printingId.slice(-2)))).toEqual(
      Array.from({ length: 6 }, () => ["c1", "c2"]),
    );
  });
});

describe("dealBasics", () => {
  it("gives everyone the same number, give or take one, and every basic to someone", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 1, max: 8 }),
        (seed, count, size) => {
          const table = Array.from({ length: size }, (_, i) => UserId.of(`p${i}`));
          const basics = Array.from({ length: count }, (_, i) => forest(i));
          const dealt = dealBasics(basics, table, seededRng(seed));
          expect(dealt.map((basic) => basic.printingId).sort()).toEqual(
            basics.map((basic) => basic.printingId).sort(),
          );
          const shares = table.map(
            (player) => dealt.filter((basic) => basic.userId === player).length,
          );
          expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  it("chooses at random who gets the spare ones", () => {
    const luckyFirst = new Set<string>();
    for (let seed = 0; seed < 50; seed += 1) {
      const dealt = dealBasics([forest(1)], players, seededRng(String(seed)));
      luckyFirst.add(dealt[0].userId);
    }
    expect(luckyFirst.size).toBe(3);
  });

  it("deals to no one at a table with no people", () => {
    expect(dealBasics([forest(1)], [], seededRng("x"))).toEqual([]);
  });
});

describe("freeBasicsFor (rule 17)", () => {
  it("covers the deck, but never past 30 owned", () => {
    expect(freeBasicsFor(10, 0)).toBe(10);
    expect(freeBasicsFor(10, 4)).toBe(6);
    expect(freeBasicsFor(10, 12)).toBe(0);
    expect(freeBasicsFor(40, 25)).toBe(FREE_BASICS_CAP - 25);
    expect(freeBasicsFor(40, 31)).toBe(0);
  });
});

describe("planBasicLands", () => {
  const catalog = new Map<Color, ReturnType<typeof samplePrintingId>>([
    ["G", samplePrintingId("set-forest")],
    ["U", samplePrintingId("set-island")],
  ]);
  const owned = (entries: Array<[Color, OwnedBasic[]]>) => new Map(entries);
  const copy = (id: string, quantity: number, finish: OwnedBasic["finish"] = "nonfoil") => ({
    printingId: samplePrintingId(id),
    finish,
    quantity,
  });

  it("shows the printing you own most of, and gives only what's missing", () => {
    const plan = planBasicLands(
      [
        { color: "G", count: 10 },
        { color: "U", count: 7 },
      ],
      owned([["G", [copy("old-forest", 2), copy("fancy-forest", 6, "foil")]]]),
      catalog,
    );
    expect(plan.deck).toEqual([
      { printingId: "fancy-forest", finish: "foil", quantity: 10 },
      { printingId: "set-island", finish: "nonfoil", quantity: 7 },
    ]);
    expect(plan.free).toEqual([
      { printingId: "set-forest", finish: "nonfoil", quantity: 2 },
      { printingId: "set-island", finish: "nonfoil", quantity: 7 },
    ]);
  });

  it("gives nothing to a player who owns enough", () => {
    const plan = planBasicLands(
      [{ color: "G", count: 17 }],
      owned([["G", [copy("f", 20)]]]),
      catalog,
    );
    expect(plan.free).toEqual([]);
  });

  it("moves a color with no basic printing at all to the main color", () => {
    const plan = planBasicLands(
      [
        { color: "G", count: 10 },
        { color: "B", count: 7 },
      ],
      owned([]),
      catalog,
    );
    expect(plan.deck).toEqual([{ printingId: "set-forest", finish: "nonfoil", quantity: 17 }]);
  });
});
