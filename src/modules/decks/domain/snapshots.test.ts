import { describe, expect, it } from "vitest";
import { err, ok } from "@/shared/kernel";
import type { Board } from "./deck";
import { compareDeckStates, type PreviewLine } from "./preview";
import type { CardRules } from "./rules";
import { checkSnapshotLabel, MAX_SNAPSHOT_LABEL_LENGTH } from "./snapshots";

function line(
  oracleId: string,
  overrides: Partial<Omit<PreviewLine, "oracleId" | "board" | "quantity" | "rules">> & {
    board?: Board;
    quantity?: number;
    rules?: Partial<CardRules>;
  } = {},
): PreviewLine {
  const name = overrides.name ?? oracleId;
  const typeLine = overrides.typeLine ?? "Creature — Elf";
  const text = overrides.text ?? "";
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
      colorIdentity: overrides.rules?.colorIdentity ?? ["G"],
      legalities: { commander: "legal" },
      isBasicLand: false,
      hasPowerToughness: /\bCreature\b/.test(typeLine),
      ...overrides.rules,
    },
  };
}

describe("checkSnapshotLabel", () => {
  it("trims and collapses whitespace", () => {
    expect(checkSnapshotLabel("  Before   final  cuts ")).toEqual(ok("Before final cuts"));
  });

  it("rejects empty or overlong labels", () => {
    expect(checkSnapshotLabel("  ")).toEqual(
      err({ kind: "SnapshotLabelInvalid", maximum: MAX_SNAPSHOT_LABEL_LENGTH }),
    );
    expect(checkSnapshotLabel("x".repeat(MAX_SNAPSHOT_LABEL_LENGTH + 1))).toEqual(
      err({ kind: "SnapshotLabelInvalid", maximum: MAX_SNAPSHOT_LABEL_LENGTH }),
    );
  });
});

describe("compareDeckStates (design doc 41)", () => {
  const cmd = line("cmd", {
    name: "Yeva",
    board: "commander",
    typeLine: "Legendary Creature — Elf",
    manaValue: 4,
    priceCents: 300,
  });

  it("reports cuts, additions, moves to maybeboard, stats, problems and price diff", () => {
    const forest = line("forest", {
      name: "Forest",
      typeLine: "Basic Land — Forest",
      manaValue: 0,
      manaCost: null,
      producedMana: ["G"],
      priceCents: 10,
      rules: { isBasicLand: true },
    });
    const filler = line("filler", {
      name: "Expensive Wurm",
      manaValue: 7,
      priceCents: 50,
    });
    const ramp = line("ramp", {
      name: "Rampant Growth",
      typeLine: "Sorcery",
      manaValue: 2,
      text: "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
      priceCents: 150,
    });

    const before: PreviewLine[] = [cmd, { ...forest, quantity: 98 }, { ...filler, quantity: 1 }];
    // Move filler to maybeboard, add Rampant Growth (short 1 copy -> owned 0)
    const after: PreviewLine[] = [
      cmd,
      { ...forest, quantity: 98 },
      { ...filler, board: "maybe", quantity: 1 },
      { ...ramp, owned: 0, quantity: 1 },
    ];

    const diff = compareDeckStates({
      format: "commander",
      targetBracket: 2,
      before,
      after,
    });

    expect(diff.before.stats.cardCount).toBe(100);
    expect(diff.after.stats.cardCount).toBe(100);
    expect(diff.priceDeltaCents).toBe(100);
    expect(diff.changes).toEqual([
      {
        oracleId: "filler",
        name: "Expensive Wurm",
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
        oracleId: "filler",
        name: "Expensive Wurm",
        board: "maybe",
        beforeQuantity: 0,
        afterQuantity: 1,
      },
    ]);
    expect(diff.roles.find((role) => role.tag === "ramp")).toMatchObject({
      before: 0,
      after: 1,
    });
    expect(diff.newlyShort).toHaveLength(1);
    expect(diff.newlyShort[0]?.name).toBe("Rampant Growth");
  });
});
