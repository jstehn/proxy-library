import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seededRng } from "@/shared/kernel";
import {
  buildGoldfishDeck,
  peekLibrary,
  startGoldfishState,
  stepGoldfishState,
  type CastModifier,
  type GoldfishAction,
  type GoldfishDeckLine,
  type GoldfishState,
  type TriggerHandler,
} from "./goldfish-session";
import { DEFAULT_CAST_MODIFIERS, DEFAULT_TRIGGER_HANDLERS } from "./sim-pipeline";

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
      key: start.value.hand[0]?.key ?? "",
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
      key: kept.value.hand[0]?.key ?? "",
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

      // alt: "blitz" without a blitz-granting permanent on the battlefield is refused
      const illegalBlitz = stepGoldfishState(tapped.value, {
        kind: "cast",
        key: sol.key,
        alt: "blitz",
      });
      expect(illegalBlitz.ok).toBe(false);
      if (!illegalBlitz.ok) expect(illegalBlitz.error.kind).toBe("CastNotAllowed");

      // Normal cast spends {1}
      const cast = stepGoldfishState(tapped.value, {
        kind: "cast",
        key: sol.key,
      });
      expect(cast.ok).toBe(true);
      if (!cast.ok) return;
      expect(cast.value.manaPool.G).toBe(0);
    }

    // With a blitz granter (Henzie) on the battlefield, creature blitz works and end_step sacrifices & draws
    const henzieLines: GoldfishDeckLine[] = [
      {
        oracleId: "henzie",
        name: 'Henzie "Toolbox" Torre',
        printingId: "p-henzie",
        board: "commander",
        quantity: 1,
        typeLine: "Legendary Creature — Devil Rogue",
        manaCost: "{B}{R}{G}",
        manaValue: 3,
        text: "Each creature spell you cast with mana value 4 or greater has blitz.",
      },
      {
        oracleId: "wurm",
        name: "Massacre Wurm",
        printingId: "p-wurm",
        board: "main",
        quantity: 10,
        typeLine: "Creature — Phyrexian Wurm",
        manaCost: "{3}{B}{B}{B}",
        manaValue: 6,
      },
      {
        oracleId: "swamp",
        name: "Swamp",
        printingId: "p-swamp",
        board: "main",
        quantity: 10,
        typeLine: "Basic Land — Swamp",
        manaValue: 0,
        producedMana: ["B"],
      },
    ];
    const hStart = startGoldfishState(buildGoldfishDeck(henzieLines), {
      format: "commander",
      rng: seededRng("11"),
    });
    expect(hStart.ok).toBe(true);
    if (!hStart.ok) return;
    const hKeep = stepGoldfishState(hStart.value, { kind: "keep" });
    expect(hKeep.ok).toBe(true);
    if (!hKeep.ok) return;
    const hT1 = stepGoldfishState(hKeep.value, { kind: "next_turn" });
    expect(hT1.ok).toBe(true);
    if (!hT1.ok) return;
    const wurm = hT1.value.hand.find((c) => c.name === "Massacre Wurm");
    expect(wurm).toBeDefined();
    if (wurm) {
      // Cannot blitz while Henzie is still in commandZone
      const noHenzie = stepGoldfishState(hT1.value, {
        kind: "cast",
        key: wurm.key,
        alt: "blitz",
        strict: false,
      });
      expect(noHenzie.ok).toBe(false);
      if (!noHenzie.ok) expect(noHenzie.error.kind).toBe("CastNotAllowed");

      // Cast Henzie to battlefield, then blitz Massacre Wurm
      const henzieCast = stepGoldfishState(hT1.value, {
        kind: "cast",
        key: "c1",
        from: "commandZone",
        strict: false,
      });
      expect(henzieCast.ok).toBe(true);
      if (!henzieCast.ok) return;
      const blitzed = stepGoldfishState(henzieCast.value, {
        kind: "cast",
        key: wurm.key,
        alt: "blitz",
        strict: false,
      });
      expect(blitzed.ok).toBe(true);
      if (!blitzed.ok) return;
      expect(blitzed.value.endStepQueue).toHaveLength(1);
      const handBeforeEnd = blitzed.value.hand.length;
      const ended = stepGoldfishState(blitzed.value, { kind: "end_step" });
      expect(ended.ok).toBe(true);
      if (!ended.ok) return;
      expect(ended.value.graveyard.some((c) => c.key === wurm.key)).toBe(true);
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

  it("handles Undying/Persist counter state and supports custom OCP CastModifier & TriggerHandler plugins", () => {
    const undyingDeck: GoldfishDeckLine[] = [
      {
        oracleId: "geralf",
        name: "Geralf's Messenger",
        printingId: "p-geralf",
        board: "main",
        quantity: 7,
        typeLine: "Creature — Zombie",
        manaCost: "{B}{B}{B}",
        manaValue: 3,
        text: "Undying (When this creature dies, if it had no +1/+1 counters on it, return it to the battlefield under its owner's control with a +1/+1 counter on it.)",
      },
      {
        oracleId: "forest",
        name: "Forest",
        printingId: "p-forest",
        board: "main",
        quantity: 7,
        typeLine: "Basic Land — Forest",
        manaValue: 0,
        producedMana: ["G"],
      },
    ];
    const start = startGoldfishState(buildGoldfishDeck(undyingDeck), {
      format: "standard",
      rng: seededRng("undying-1"),
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const t1 = stepGoldfishState(start.value, { kind: "next_turn" });
    expect(t1.ok).toBe(true);
    if (!t1.ok) return;

    const messenger = t1.value.hand.find((c) => c.name === "Geralf's Messenger");
    expect(messenger).toBeDefined();
    if (!messenger) return;

    const cast = stepGoldfishState(t1.value, {
      kind: "cast",
      key: messenger.key,
      strict: false,
    });
    expect(cast.ok).toBe(true);
    if (!cast.ok) return;

    // First death: returns to battlefield with a +1/+1 counter
    const diedOnce = stepGoldfishState(cast.value, {
      kind: "move",
      key: messenger.key,
      from: "battlefield",
      to: "graveyard",
    });
    expect(diedOnce.ok).toBe(true);
    if (!diedOnce.ok) return;
    const returnedPerm = diedOnce.value.battlefield.find((p) => p.card.key === messenger.key);
    expect(returnedPerm).toBeDefined();
    expect(returnedPerm?.counters?.["+1/+1"]).toBe(1);

    // Second death: already has +1/+1 counter, so it stays in graveyard
    const diedTwice = stepGoldfishState(diedOnce.value, {
      kind: "move",
      key: messenger.key,
      from: "battlefield",
      to: "graveyard",
    });
    expect(diedTwice.ok).toBe(true);
    if (!diedTwice.ok) return;
    expect(diedTwice.value.battlefield.some((p) => p.card.key === messenger.key)).toBe(false);
    expect(diedTwice.value.graveyard.some((c) => c.key === messenger.key)).toBe(true);

    // Custom CastModifier (affinity-style discount) + custom TriggerHandler (landfall +1G)
    const artifactDiscount: CastModifier = {
      id: "test_artifact_discount",
      applies: (ctx) => ctx.alt === "affinity",
      apply: (ctx) => ({
        allowed: true,
        genericDelta: -ctx.state.battlefield.length,
      }),
    };
    const landfallMana: TriggerHandler = {
      id: "test_landfall_mana",
      handles: (event) => event.kind === "PermanentEntered" && event.permanent.card.isLand,
      run: (_event, s) => ({
        state: { ...s, manaPool: { ...s.manaPool, G: s.manaPool.G + 1 } },
      }),
    };

    const forest = diedTwice.value.hand.find((c) => c.name === "Forest");
    expect(forest).toBeDefined();
    if (!forest) return;
    const afterLandfall = stepGoldfishState(
      diedTwice.value,
      { kind: "play_land", key: forest.key },
      {
        castModifiers: [...DEFAULT_CAST_MODIFIERS, artifactDiscount],
        triggerHandlers: [...DEFAULT_TRIGGER_HANDLERS, landfallMana],
      },
    );
    expect(afterLandfall.ok).toBe(true);
    if (!afterLandfall.ok) return;
    expect(afterLandfall.value.manaPool.G).toBe(1);
  });
});
