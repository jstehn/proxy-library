import { describe, expect, it } from "vitest";
import type { Board } from "./deck";
import { previewChanges, type PreviewLine } from "./preview";
import type { CardRules } from "./rules";

function makeCard(
  oracleId: string,
  overrides: Partial<Omit<PreviewLine, "oracleId" | "board" | "quantity" | "rules">> & {
    board?: Board;
    quantity?: number;
    rules?: Partial<CardRules>;
  } = {},
): PreviewLine {
  const name = overrides.name ?? oracleId;
  const typeLine = overrides.typeLine ?? "Creature — Bear";
  const text = overrides.text ?? "";
  const colorIdentity = overrides.rules?.colorIdentity ?? ["G"];
  return {
    oracleId,
    name,
    board: overrides.board ?? "main",
    quantity: overrides.quantity ?? 1,
    manaValue: overrides.manaValue ?? 2,
    typeLine,
    manaCost: overrides.manaCost ?? "{1}{G}",
    producedMana: overrides.producedMana ?? [],
    priceCents: overrides.priceCents ?? 100,
    text,
    isGameChanger: overrides.isGameChanger ?? false,
    owned: overrides.owned ?? 1,
    rules: {
      name,
      typeLine,
      text,
      colorIdentity,
      legalities: { commander: "legal", modern: "legal" },
      isBasicLand: false,
      hasPowerToughness: /\bCreature\b/.test(typeLine),
      ...overrides.rules,
    },
  };
}

describe("previewChanges (design doc 40, section 3)", () => {
  const commander = makeCard("cmd", {
    name: "Yeva, Nature's Herald",
    board: "commander",
    typeLine: "Legendary Creature — Elf Shaman",
    manaValue: 4,
    priceCents: 200,
  });

  it("reports size, curve, roles against targets, price delta, and problem diff", () => {
    const catalog: Record<string, PreviewLine> = {
      // Already in deck: off-color bolt causes OutsideColorIdentity, two forests make 99 main + 1 cmd = 100
      bolt: makeCard("bolt", {
        name: "Lightning Bolt",
        typeLine: "Instant",
        manaValue: 1,
        manaCost: "{R}",
        text: "Lightning Bolt deals 3 damage to any target.",
        priceCents: 150,
        rules: { colorIdentity: ["R"] },
      }),
      ramp: makeCard("ramp", {
        name: "Rampant Growth",
        typeLine: "Sorcery",
        manaValue: 2,
        manaCost: "{1}{G}",
        text: "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
        priceCents: 50,
      }),
      study: makeCard("study", {
        name: "Rhystic Study",
        typeLine: "Enchantment",
        manaValue: 3,
        manaCost: "{2}{U}",
        text: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
        isGameChanger: true,
        priceCents: 4000,
        owned: 0,
        rules: { colorIdentity: ["U"] },
      }),
    };
    const rampAlready = Array.from({ length: 9 }, (_, index) =>
      makeCard(`ramp-${index}`, {
        name: `Elvish Mystic ${index}`,
        typeLine: "Creature — Elf Druid",
        manaValue: 1,
        producedMana: ["G"],
        text: "{T}: Add {G}.",
        priceCents: 25,
      }),
    );
    const forests = makeCard("forest", {
      name: "Forest",
      typeLine: "Basic Land — Forest",
      manaValue: 0,
      manaCost: null,
      producedMana: ["G"],
      quantity: 89,
      priceCents: 10,
      rules: { isBasicLand: true, legalities: { commander: "legal" } },
    });

    const preview = previewChanges({
      format: "commander",
      targetBracket: 2,
      before: [commander, catalog.bolt, ...rampAlready, forests],
      changes: [
        { oracleId: "bolt", board: "main", quantity: 0 },
        { oracleId: "ramp", board: "main", quantity: 1 },
        // A duplicate change to the same card/board: later value wins
        { oracleId: "study", board: "main", quantity: 0 },
        { oracleId: "study", board: "maybe", quantity: 1 },
      ],
      facts: (oracleId) => catalog[oracleId],
    });

    expect(preview.before.stats.cardCount).toBe(100);
    expect(preview.after.stats.cardCount).toBe(100);
    expect(preview.newlyMetRoles).toEqual(["ramp"]);
    expect(preview.problems.resolved.map((problem) => problem.kind)).toContain(
      "OutsideColorIdentity",
    );
    expect(preview.problems.added).toEqual([]); // Rhystic Study went to maybeboard, so not counted!
    expect(preview.priceDeltaCents).toBe(50 - 150); // maybeboard price is not counted either
    expect(preview.changes).toEqual([
      {
        oracleId: "bolt",
        name: "Lightning Bolt",
        board: "main",
        beforeQuantity: 1,
        afterQuantity: 0,
      },
      {
        oracleId: "ramp",
        name: "Rampant Growth",
        board: "main",
        beforeQuantity: 0,
        afterQuantity: 1,
      },
      {
        oracleId: "study",
        name: "Rhystic Study",
        board: "main",
        beforeQuantity: 0,
        afterQuantity: 0,
      },
      {
        oracleId: "study",
        name: "Rhystic Study",
        board: "maybe",
        beforeQuantity: 0,
        afterQuantity: 1,
      },
    ]);
  });

  it("moves a card to maybeboard and reports bracket warnings & shortages when crossing target", () => {
    const bolt = makeCard("bolt", { name: "Lightning Bolt", owned: 1 });
    const tutor = makeCard("study", {
      name: "Rhystic Study",
      typeLine: "Enchantment",
      manaValue: 3,
      isGameChanger: true,
      owned: 0,
      rules: { colorIdentity: ["G"] },
    });
    const preview = previewChanges({
      format: "commander",
      targetBracket: 2,
      before: [commander, bolt],
      changes: [
        { oracleId: "bolt", board: "main", quantity: 0 },
        { oracleId: "bolt", board: "maybe", quantity: 1 },
        { oracleId: "study", board: "main", quantity: 1 },
      ],
      facts: () => tutor,
    });

    expect(preview.before.stats.cardCount).toBe(2);
    expect(preview.after.stats.cardCount).toBe(2);
    expect(preview.bracket.before?.floor).toBe(1);
    expect(preview.bracket.after?.floor).toBe(3);
    expect(preview.bracket.warningAfter?.target).toBe(2);
    expect(preview.newlyShort).toEqual([
      { kind: "Short", oracleId: "study", name: "Rhystic Study", needed: 1, owned: 0 },
    ]);
  });

  it("treats changed Short counts as resolved-old + added-new", () => {
    const bolt = makeCard("bolt", { name: "Lightning Bolt", owned: 1, quantity: 3 });
    const preview = previewChanges({
      format: "modern",
      targetBracket: null,
      before: [bolt],
      changes: [{ oracleId: "bolt", board: "main", quantity: 2 }],
      facts: () => bolt,
    });
    expect(preview.problems.resolved).toContainEqual({
      kind: "Short",
      oracleId: "bolt",
      name: "Lightning Bolt",
      needed: 3,
      owned: 1,
    });
    expect(preview.problems.added).toContainEqual({
      kind: "Short",
      oracleId: "bolt",
      name: "Lightning Bolt",
      needed: 2,
      owned: 1,
    });
    expect(preview.newlyShort).toEqual([]);
  });
});
