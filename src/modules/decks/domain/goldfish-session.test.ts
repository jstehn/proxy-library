import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seededRng } from "@/shared/kernel";
import {
  buildGoldfishDeck,
  peekLibrary,
  startGoldfishState,
  stepGoldfishState,
  type GoldfishAction,
  type GoldfishDeckLine,
  type GoldfishState,
} from "./goldfish-session";

function sampleDeckLines(): GoldfishDeckLine[] {
  return [
    {
      oracleId: "cmd-1",
      name: "Kinnan, Bonder Prodigy",
      printingId: "p-cmd",
      board: "commander",
      quantity: 1,
      typeLine: "Legendary Creature — Human Druid",
      manaCost: "{G}{U}",
      manaValue: 2,
    },
    {
      oracleId: "forest",
      name: "Forest",
      printingId: "p-forest",
      board: "main",
      quantity: 12,
      typeLine: "Basic Land — Forest",
      manaValue: 0,
      producedMana: ["G"],
    },
    {
      oracleId: "sol-ring",
      name: "Sol Ring",
      printingId: "p-sol",
      board: "main",
      quantity: 2,
      typeLine: "Artifact",
      manaCost: "{1}",
      manaValue: 1,
      text: "{T}: Add {C}{C}.",
    },
    {
      oracleId: "opt",
      name: "Opt",
      printingId: "p-opt",
      board: "main",
      quantity: 6,
      typeLine: "Instant",
      manaCost: "{U}",
      manaValue: 1,
      text: "Scry 1. Draw a card.",
    },
    {
      oracleId: "sb-card",
      name: "Negate",
      printingId: "p-negate",
      board: "side",
      quantity: 2,
      typeLine: "Instant",
      manaCost: "{1}{U}",
      manaValue: 2,
    },
  ];
}

function allKeys(state: GoldfishState): string[] {
  return [
    ...state.library.map((c) => c.key),
    ...state.hand.map((c) => c.key),
    ...state.battlefield.map((p) => p.card.key),
    ...state.graveyard.map((c) => c.key),
    ...state.exile.map((c) => c.key),
    ...state.commandZone.map((c) => c.key),
  ].sort();
}

describe("goldfish-session", () => {
  it("builds library and commandZone while excluding sideboard", () => {
    const built = buildGoldfishDeck(sampleDeckLines());
    expect(built.library).toHaveLength(20);
    expect(built.commandZone).toHaveLength(1);
    expect(built.commandZone[0].name).toBe("Kinnan, Bonder Prodigy");
  });

  it("handles Commander free first mulligan and London bottoming", () => {
    const built = buildGoldfishDeck(sampleDeckLines());
    const start = startGoldfishState(built, { format: "commander", rng: seededRng("42") });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    expect(start.value.hand).toHaveLength(7);
    expect(start.value.library).toHaveLength(13);

    // First mulligan in Commander is free (toBottom === 0)
    const mul1 = stepGoldfishState(start.value, { kind: "mulligan", rng: seededRng("43") });
    expect(mul1.ok).toBe(true);
    if (!mul1.ok) return;
    expect(mul1.value.mulligans).toBe(1);
    expect(mul1.value.toBottom).toBe(0);

    // Second mulligan requires bottoming 1 card
    const mul2 = stepGoldfishState(mul1.value, { kind: "mulligan", rng: seededRng("44") });
    expect(mul2.ok).toBe(true);
    if (!mul2.ok) return;
    expect(mul2.value.toBottom).toBe(1);

    // Cannot advance turn while toBottom > 0
    const blocked = stepGoldfishState(mul2.value, { kind: "next_turn" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.kind).toBe("PendingBottom");

    const bottomKey = mul2.value.hand[0].key;
    const kept = stepGoldfishState(mul2.value, { kind: "bottom", keys: [bottomKey] });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.value.toBottom).toBe(0);
    expect(kept.value.hand).toHaveLength(6);
    expect(kept.value.library[kept.value.library.length - 1].key).toBe(bottomKey);
  });

  it("enforces turn-1 play/draw rule, land limit, cast routing, and untap", () => {
    const built = buildGoldfishDeck(sampleDeckLines());
    const start = startGoldfishState(built, {
      format: "standard",
      rng: seededRng("7"),
      onTheDraw: false,
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    // Turn 1 on the play: no draw
    const t1 = stepGoldfishState(start.value, { kind: "next_turn" });
    expect(t1.ok).toBe(true);
    if (!t1.ok) return;
    expect(t1.value.turn).toBe(1);
    expect(t1.value.hand).toHaveLength(7);

    // Play a land (or move one to hand if none in this seed, then play it)
    const land = t1.value.hand.find((c) => c.isLand);
    expect(land).toBeDefined();
    if (!land) return;
    const afterLand = stepGoldfishState(t1.value, {
      kind: "play_land",
      key: land.key,
      tapped: true,
    });
    expect(afterLand.ok).toBe(true);
    if (!afterLand.ok) return;
    expect(afterLand.value.battlefield).toHaveLength(1);
    expect(afterLand.value.battlefield[0].tapped).toBe(true);

    // Second land in same turn is rejected unless ignoreLandLimit
    const anotherLand = afterLand.value.hand.find((c) => c.isLand);
    if (anotherLand) {
      const blockedLand = stepGoldfishState(afterLand.value, {
        kind: "play_land",
        key: anotherLand.key,
      });
      expect(blockedLand.ok).toBe(false);
      if (!blockedLand.ok) expect(blockedLand.error.kind).toBe("LandLimitReached");
    }

    // Turn 2 untaps battlefield and draws 1
    const t2 = stepGoldfishState(afterLand.value, { kind: "next_turn" });
    expect(t2.ok).toBe(true);
    if (!t2.ok) return;
    expect(t2.value.turn).toBe(2);
    expect(t2.value.battlefield[0].tapped).toBe(false);
    expect(t2.value.landsPlayedThisTurn).toBe(0);
    expect(t2.value.hand).toHaveLength(7); // played 1 land (-1), drew 1 (+1)
  });

  it("peeks top N cards without mutating library", () => {
    const built = buildGoldfishDeck(sampleDeckLines());
    const start = startGoldfishState(built, { format: "commander", rng: seededRng("1") });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const peeked = peekLibrary(start.value, 3);
    expect(peeked).toHaveLength(3);
    expect(peeked.map((c) => c.key)).toEqual(start.value.library.slice(0, 3).map((c) => c.key));
  });

  it("preserves every card key across arbitrary valid action sequences (property test)", () => {
    const built = buildGoldfishDeck(sampleDeckLines());
    const initial = startGoldfishState(built, { format: "commander", rng: seededRng("99") });
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const expectedKeys = allKeys(initial.value);

    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 25 }),
        (ops) => {
          let state = initial.value;
          for (let i = 0; i < ops.length; i++) {
            let action: GoldfishAction;
            switch (ops[i]) {
              case 0:
                action = { kind: "next_turn" };
                break;
              case 1:
                action = { kind: "draw", count: 1 };
                break;
              case 2:
                action = { kind: "shuffle_library", rng: seededRng(`s-${i}`) };
                break;
              case 3: {
                const card = state.hand[0];
                action = card ? { kind: "cast", key: card.key } : { kind: "draw", count: 1 };
                break;
              }
              case 4: {
                const perm = state.battlefield[0];
                action = perm
                  ? { kind: perm.tapped ? "untap" : "tap", key: perm.card.key }
                  : { kind: "next_turn" };
                break;
              }
              default: {
                const gy = state.graveyard[0];
                action = gy
                  ? { kind: "move", key: gy.key, from: "graveyard", to: "library_bottom" }
                  : { kind: "next_turn" };
                break;
              }
            }
            const res = stepGoldfishState(state, action);
            if (res.ok) state = res.value;
            expect(allKeys(state)).toEqual(expectedKeys);
          }
        },
      ),
    );
  });

  it("enforces keep/turn-1, strict mana, commander tax, blitz, and short keys (Goldfish v2)", () => {
    const built = buildGoldfishDeck(sampleDeckLines());
    expect(built.commandZone[0]?.key).toBe("c1");
    expect(built.library[0]?.key).toBe("k1");

    const start = startGoldfishState(built, { format: "commander", rng: seededRng("99") });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    // Cannot cast on turn 0 before keeping
    const preKeep = stepGoldfishState(start.value, {
      kind: "cast",
      key: start.value.hand[0]!.key,
    });
    expect(preKeep.ok).toBe(false);
    if (!preKeep.ok) expect(preKeep.error.kind).toBe("CastNotAllowed");

    const kept = stepGoldfishState(start.value, { kind: "keep" });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.value.kept).toBe(true);

    // Still turn 0 -> cannot cast yet
    const turn0Cast = stepGoldfishState(kept.value, {
      kind: "cast",
      key: kept.value.hand[0]!.key,
    });
    expect(turn0Cast.ok).toBe(false);

    const t1 = stepGoldfishState(kept.value, { kind: "next_turn" });
    expect(t1.ok).toBe(true);
    if (!t1.ok) return;

    // Strict mode blocks casting Sol Ring without tapping mana
    const sol = t1.value.hand.find((c) => c.name === "Sol Ring");
    const forest = t1.value.hand.find((c) => c.name === "Forest");
    if (sol && forest) {
      const noMana = stepGoldfishState(t1.value, { kind: "cast", key: sol.key });
      expect(noMana.ok).toBe(false);
      if (!noMana.ok) expect(noMana.error.kind).toBe("InsufficientMana");

      const played = stepGoldfishState(t1.value, { kind: "play_land", key: forest.key });
      expect(played.ok).toBe(true);
      if (!played.ok) return;
      const tapped = stepGoldfishState(played.value, { kind: "tap", key: forest.key });
      expect(tapped.ok).toBe(true);
      if (!tapped.ok) return;
      expect(tapped.value.manaPool.G).toBe(1);

      // Cast Sol Ring with alt: "blitz" and verify end_step sacrifices & draws
      const blitzed = stepGoldfishState(tapped.value, {
        kind: "cast",
        key: sol.key,
        alt: "blitz",
      });
      expect(blitzed.ok).toBe(true);
      if (!blitzed.ok) return;
      expect(blitzed.value.manaPool.G).toBe(0);
      expect(blitzed.value.endStepQueue).toHaveLength(1);

      const handBeforeEnd = blitzed.value.hand.length;
      const ended = stepGoldfishState(blitzed.value, { kind: "end_step" });
      expect(ended.ok).toBe(true);
      if (!ended.ok) return;
      expect(ended.value.graveyard.some((c) => c.key === sol.key)).toBe(true);
      expect(ended.value.hand.length).toBe(handBeforeEnd + 1);
      expect(ended.value.endStepQueue).toHaveLength(0);
    }

    // Commander cast increments commandCasts and adds +2 tax on next cast
    const cmdCast1 = stepGoldfishState(t1.value, {
      kind: "cast",
      key: "c1",
      from: "commandZone",
      strict: false,
    });
    expect(cmdCast1.ok).toBe(true);
    if (!cmdCast1.ok) return;
    expect(cmdCast1.value.commandCasts).toBe(1);

    const movedBack = stepGoldfishState(cmdCast1.value, {
      kind: "move",
      key: "c1",
      from: "battlefield",
      to: "commandZone",
    });
    expect(movedBack.ok).toBe(true);
    if (!movedBack.ok) return;

    const cmdCast2Strict = stepGoldfishState(movedBack.value, {
      kind: "cast",
      key: "c1",
      from: "commandZone",
      strict: true,
    });
    expect(cmdCast2Strict.ok).toBe(false);
    if (!cmdCast2Strict.ok) {
      expect(cmdCast2Strict.error.kind).toBe("InsufficientMana");
      if (cmdCast2Strict.error.kind === "InsufficientMana") {
        expect(cmdCast2Strict.error.required).toContain("tax");
      }
    }
  });
});
