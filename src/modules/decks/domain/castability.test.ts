import { describe, expect, it } from "vitest";
import { seededRng } from "@/shared/kernel";
import { EMPTY_DECK_PROFILE, type DeckProfile } from "./deck-profile";
import { simulateCastOnCurve, type CastabilityLine } from "./castability";

function spell(name: string, manaCost: string, manaValue: number, quantity = 1): CastabilityLine {
  return {
    oracleId: `spell-${name}`,
    name,
    board: "main",
    quantity,
    typeLine: "Creature — Elf",
    manaValue,
    manaCost,
    producedMana: [],
    text: "",
  };
}

function land(
  name: string,
  producedMana: readonly string[],
  quantity: number,
  text = "",
): CastabilityLine {
  return {
    oracleId: `land-${name}`,
    name,
    board: "main",
    quantity,
    typeLine: "Land",
    manaValue: 0,
    manaCost: null,
    producedMana,
    text,
  };
}

describe("simulateCastOnCurve", () => {
  it("is deterministic for a fixed seed and identifies bottleneck colors", () => {
    const deck: CastabilityLine[] = [
      land("Forest", ["G"], 32),
      land("Swamp", ["B"], 4),
      spell("Llanowar Elves", "{G}", 1),
      spell("Phyrexian Obliterator", "{B}{B}{B}{B}", 4),
      ...Array.from({ length: 62 }, (_, i) => spell(`Filler ${i}`, "{2}{G}", 3)),
    ];

    const a = simulateCastOnCurve(deck, { rng: seededRng("test-seed"), trials: 300 });
    const b = simulateCastOnCurve(deck, { rng: seededRng("test-seed"), trials: 300 });
    expect(a).toEqual(b);

    const obliterator = a.spells.find((s) => s.name === "Phyrexian Obliterator");
    const elves = a.spells.find((s) => s.name === "Llanowar Elves");
    expect(obliterator).toBeDefined();
    expect(elves).toBeDefined();
    expect(obliterator?.castOnCurvePct).toBeLessThan(0.2);
    expect(obliterator?.bottleneckColor).toBe("B");
    expect(elves?.castOnCurvePct).toBeGreaterThan(0.8);
    expect(a.struggling.some((s) => s.name === "Phyrexian Obliterator")).toBe(true);
  });

  it("improves castability when untapped colored sources replace off-color lands", () => {
    const base: CastabilityLine[] = [
      land("Forest", ["G"], 34),
      land("Swamp", ["B"], 2),
      spell("Necropotence", "{B}{B}{B}", 3),
      ...Array.from({ length: 62 }, (_, i) => spell(`Filler ${i}`, "{1}{G}", 2)),
    ];
    const fixed: CastabilityLine[] = [
      land("Forest", ["G"], 20),
      land("Swamp", ["B"], 16),
      spell("Necropotence", "{B}{B}{B}", 3),
      ...Array.from({ length: 62 }, (_, i) => spell(`Filler ${i}`, "{1}{G}", 2)),
    ];

    const before = simulateCastOnCurve(base, { rng: seededRng("mono"), trials: 400 });
    const after = simulateCastOnCurve(fixed, { rng: seededRng("mono"), trials: 400 });

    const necroBefore = before.spells.find((s) => s.name === "Necropotence")?.castOnCurvePct ?? 0;
    const necroAfter = after.spells.find((s) => s.name === "Necropotence")?.castOnCurvePct ?? 0;
    expect(necroAfter).toBeGreaterThan(necroBefore);
  });

  it("applies general deck-profile costReducers for Goreclaw, Spellslinger, and Henzie", () => {
    const deck: CastabilityLine[] = [
      land("Forest", ["G"], 18),
      land("Island", ["U"], 18),
      {
        oracleId: "big-beast",
        name: "Carnage Tyrant",
        board: "main",
        quantity: 1,
        typeLine: "Creature — Dinosaur",
        manaValue: 6,
        manaCost: "{4}{G}{G}",
        power: "7",
        text: "Trample",
      },
      {
        oracleId: "small-utility",
        name: "Mulldrifter",
        board: "main",
        quantity: 1,
        typeLine: "Creature — Elemental",
        manaValue: 6,
        manaCost: "{5}{U}",
        power: "2",
        text: "Flying",
      },
      {
        oracleId: "big-sorcery",
        name: "Time Stretch",
        board: "main",
        quantity: 1,
        typeLine: "Sorcery",
        manaValue: 6,
        manaCost: "{4}{U}{U}",
        text: "Take two extra turns.",
      },
      ...Array.from({ length: 60 }, (_, i) => spell(`Filler ${i}`, "{1}{G}", 2)),
    ];

    const baseline = simulateCastOnCurve(deck, { rng: seededRng("cmd"), trials: 400 });
    const goreclawProfile: DeckProfile = {
      ...EMPTY_DECK_PROFILE,
      costReducers: [
        { cardName: "Goreclaw", scope: "creatures", minPower: 4, genericReduction: 2 },
      ],
    };
    const goreclaw = simulateCastOnCurve(deck, {
      rng: seededRng("cmd"),
      trials: 400,
      profile: goreclawProfile,
    });

    const baseTyrant =
      baseline.spells.find((s) => s.name === "Carnage Tyrant")?.castOnCurvePct ?? 0;
    const goreTyrant =
      goreclaw.spells.find((s) => s.name === "Carnage Tyrant")?.castOnCurvePct ?? 0;
    const baseMull = baseline.spells.find((s) => s.name === "Mulldrifter")?.castOnCurvePct ?? 0;
    const goreMull = goreclaw.spells.find((s) => s.name === "Mulldrifter")?.castOnCurvePct ?? 0;
    expect(goreTyrant).toBeGreaterThan(baseTyrant);
    expect(goreMull).toBe(baseMull);

    const mizzixProfile: DeckProfile = {
      ...EMPTY_DECK_PROFILE,
      costReducers: [{ cardName: "Mizzix", scope: "instants_sorceries", genericReduction: 2 }],
    };
    const mizzix = simulateCastOnCurve(deck, {
      rng: seededRng("cmd"),
      trials: 400,
      profile: mizzixProfile,
    });
    const baseSorcery = baseline.spells.find((s) => s.name === "Time Stretch")?.castOnCurvePct ?? 0;
    const mizzixSorcery = mizzix.spells.find((s) => s.name === "Time Stretch")?.castOnCurvePct ?? 0;
    const mizzixTyrant =
      mizzix.spells.find((s) => s.name === "Carnage Tyrant")?.castOnCurvePct ?? 0;
    expect(mizzixSorcery).toBeGreaterThan(baseSorcery);
    expect(mizzixTyrant).toBe(baseTyrant);

    const henzieProfile: DeckProfile = {
      ...EMPTY_DECK_PROFILE,
      costReducers: [
        {
          cardName: "Henzie",
          scope: "creatures",
          minManaValue: 4,
          genericReduction: 1,
          perCommandCast: true,
        },
      ],
    };
    const henzie = simulateCastOnCurve(deck, {
      rng: seededRng("cmd"),
      trials: 400,
      profile: henzieProfile,
    });
    const henzieTyrant =
      henzie.spells.find((s) => s.name === "Carnage Tyrant")?.castOnCurvePct ?? 0;
    const henzieSorcery = henzie.spells.find((s) => s.name === "Time Stretch")?.castOnCurvePct ?? 0;
    expect(henzieTyrant).toBeGreaterThan(baseTyrant);
    expect(henzieSorcery).toBe(baseSorcery);

    // Commander self-reduction (e.g. Ghalta {10}{G}{G}) improves commander castability on curve
    const ghaltaDeck: CastabilityLine[] = [
      land("Forest", ["G"], 36),
      {
        oracleId: "ghalta",
        name: "Ghalta, Primal Hunger",
        board: "commander",
        quantity: 1,
        typeLine: "Legendary Creature — Elder Dinosaur",
        manaValue: 12,
        manaCost: "{10}{G}{G}",
        power: "12",
        text: "This spell costs {X} less to cast, where X is the total power of creatures you control.",
      },
      ...Array.from({ length: 63 }, (_, i) => spell(`Filler ${i}`, "{1}{G}", 2)),
    ];
    const ghaltaBase = simulateCastOnCurve(ghaltaDeck, { rng: seededRng("ghalta"), trials: 400 });
    const ghaltaReduced = simulateCastOnCurve(ghaltaDeck, {
      rng: seededRng("ghalta"),
      trials: 400,
      profile: {
        ...EMPTY_DECK_PROFILE,
        costReducers: [
          { cardName: "Ghalta, Primal Hunger", scope: "commander", genericReduction: 8 },
        ],
      },
    });
    const ghaltaBasePct =
      ghaltaBase.spells.find((s) => s.name === "Ghalta, Primal Hunger")?.castOnCurvePct ?? 0;
    const ghaltaReducedPct =
      ghaltaReduced.spells.find((s) => s.name === "Ghalta, Primal Hunger")?.castOnCurvePct ?? 0;
    expect(ghaltaReducedPct).toBeGreaterThan(ghaltaBasePct);
  });

  it("models hybrid/Phyrexian pips, multi-mana rocks, MDFC lands, and colorless cost reducers", () => {
    const deck: CastabilityLine[] = [
      land("Swamp", ["B"], 34),
      {
        oracleId: "sol-ring",
        name: "Sol Ring",
        board: "main",
        quantity: 2,
        typeLine: "Artifact",
        manaValue: 1,
        manaCost: "{1}",
        producedMana: ["C"],
        text: "{T}: Add {C}{C}.",
      },
      {
        oracleId: "mdfc",
        name: "Bala Ged Recovery // Bala Ged Sanctuary",
        board: "main",
        quantity: 2,
        typeLine: "Sorcery // Land",
        manaValue: 3,
        manaCost: "{2}{G}",
        producedMana: ["G"],
        text: "Return target card from your graveyard to your hand. // Bala Ged Sanctuary enters tapped.",
      },
      spell("Ashiok, Dream Render", "{1}{U/B}{U/B}", 3),
      spell("Mutagenic Growth", "{G/P}", 1),
      {
        oracleId: "kozilek",
        name: "Kozilek",
        board: "main",
        quantity: 1,
        typeLine: "Legendary Creature — Eldrazi",
        manaValue: 10,
        manaCost: "{8}{C}{C}",
      },
      ...Array.from({ length: 59 }, (_, i) => spell(`Filler ${i}`, "{2}{B}", 3)),
    ];

    const base = simulateCastOnCurve(deck, { rng: seededRng("hybrid-1"), trials: 400 });
    const ashiok = base.spells.find((s) => s.name === "Ashiok, Dream Render");
    const mutagenic = base.spells.find((s) => s.name === "Mutagenic Growth");
    expect(ashiok?.castOnCurvePct).toBeGreaterThan(0.7);
    expect(mutagenic?.castOnCurvePct).toBeGreaterThan(0.85);

    const withUgin = simulateCastOnCurve(deck, {
      rng: seededRng("hybrid-1"),
      trials: 400,
      profile: {
        ...EMPTY_DECK_PROFILE,
        costReducers: [
          { cardName: "Ugin, the Ineffable", scope: "colorless", genericReduction: 2 },
        ],
      },
    });
    const kozilekBase = base.spells.find((s) => s.name === "Kozilek")?.castOnCurvePct ?? 0;
    const kozilekUgin = withUgin.spells.find((s) => s.name === "Kozilek")?.castOnCurvePct ?? 0;
    expect(kozilekUgin).toBeGreaterThan(kozilekBase);
  });
});
