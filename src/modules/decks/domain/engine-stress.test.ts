import { describe, expect, it } from "vitest";
import { seededRng } from "@/shared/kernel";
import {
  buildGoldfishDeck,
  startGoldfishState,
  stepGoldfishState,
  type GoldfishAction,
  type GoldfishCard,
  type GoldfishDeckLine,
  type GoldfishState,
  type ReplacementEffect,
  type StepGoldfishOptions,
  type TriggerHandler,
  type ZoneChangeReplacement,
} from "./goldfish-session";
import {
  addCardToZone,
  DEFAULT_REPLACEMENT_EFFECTS,
  DEFAULT_TRIGGER_HANDLERS,
  runStateBasedActions,
} from "./sim-pipeline";

function mustStep(
  state: GoldfishState,
  action: GoldfishAction,
  options?: StepGoldfishOptions,
): GoldfishState {
  const res = stepGoldfishState(state, action, options);
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(`Unexpected step error: ${res.error.kind}`);
  return res.value;
}

function findCardByName(cards: readonly GoldfishCard[], name: string): GoldfishCard {
  const found = cards.find((c) => c.name === name);
  if (!found) throw new Error(`Card not found in fixture: ${name}`);
  return found;
}

describe("OCP Engine Stress Tests: Kira Nerys, Myriad, Haste Mana, and Ashnod's Altar", () => {
  it("models Kira Nerys, Firebrand (replacement effect + ETB +1/+1 until EOT) + Myriad tokens", () => {
    const deck: GoldfishDeckLine[] = [
      {
        oracleId: "kira",
        name: "Kira Nerys, Firebrand",
        printingId: "p-kira",
        board: "commander",
        quantity: 1,
        typeLine: "Legendary Creature — Bajoran Soldier",
        manaCost: "{1}{R}{W}",
        manaValue: 3,
        text: "Trample\nIf a creature you control would enter while you control an attacking creature, instead it enters tapped and attacking.\nWhenever another creature you control enters, it gets +1/+1 until end of turn.",
      },
      {
        oracleId: "blade",
        name: "Blade of Selves Bearer",
        printingId: "p-blade",
        board: "main",
        quantity: 7,
        typeLine: "Creature — Soldier",
        manaCost: "{2}{W}",
        manaValue: 3,
        text: "Myriad (Whenever this creature attacks, for each opponent other than defending player, you may create a token that's a copy of it that's tapped and attacking that player or a planeswalker they control. Exile the tokens at end of combat.)",
      },
    ];

    const enterTappedAndAttackingReplacement: ReplacementEffect = {
      id: "enter_tapped_and_attacking_if_attacking",
      applies: (intent, state) =>
        /\bCreature\b/i.test(intent.card.typeLine) &&
        state.battlefield.some((p) => p.abilities?.includes("attacking")) &&
        state.battlefield.some((p) =>
          /would enter while you control an attacking creature, instead it enters tapped and attacking/i.test(
            p.card.text ?? "",
          ),
        ),
      replace: (intent) => ({
        ...intent,
        tapped: true,
        abilities: Array.from(new Set([...intent.abilities, "attacking"])),
      }),
    };

    const etbPlusOnePlusOneTrigger: TriggerHandler = {
      id: "etb_other_creature_plus_one",
      handles: (event, state) =>
        event.kind === "PermanentEntered" &&
        /\bCreature\b/i.test(event.permanent.card.typeLine) &&
        state.battlefield.some(
          (p) =>
            p.card.key !== event.permanent.card.key &&
            /whenever another creature you control enters, it gets \+1\/\+1 until end of turn/i.test(
              p.card.text ?? "",
            ),
        ),
      run(event, state) {
        if (event.kind !== "PermanentEntered") return { state };
        const battlefield = state.battlefield.map((p) =>
          p.card.key === event.permanent.card.key
            ? {
                ...p,
                tempModifiers: [
                  ...(p.tempModifiers ?? []),
                  { kind: "pt" as const, power: 1, toughness: 1 },
                ],
              }
            : p,
        );
        return { state: { ...state, battlefield } };
      },
    };

    let tokenSeq = 1;
    const myriadTrigger: TriggerHandler = {
      id: "myriad_on_attack",
      handles: (event) =>
        event.kind === "CreatureAttacked" && /\bmyriad\b/i.test(event.permanent.card.text ?? ""),
      run(event, state) {
        if (event.kind !== "CreatureAttacked") return { state };
        const copies = Math.max(0, event.opponentCount - 1);
        let next = state;
        const events = [];
        for (let i = 0; i < copies; i++) {
          const tokenCard = {
            ...event.permanent.card,
            key: `tok-${tokenSeq++}`,
            isCommander: false,
            isToken: true,
          };
          next = addCardToZone(next, "battlefield", tokenCard, {
            tapped: true,
            abilities: ["attacking", "exile_at_end_of_combat"],
            from: "token",
            replacementEffects: [enterTappedAndAttackingReplacement],
          });
          const entered = next.battlefield[next.battlefield.length - 1];
          if (entered) events.push({ kind: "PermanentEntered" as const, permanent: entered });
        }
        return { state: next, events };
      },
    };

    const opts: StepGoldfishOptions = {
      replacementEffects: [...DEFAULT_REPLACEMENT_EFFECTS, enterTappedAndAttackingReplacement],
      triggerHandlers: [...DEFAULT_TRIGGER_HANDLERS, etbPlusOnePlusOneTrigger, myriadTrigger],
    };

    const start = startGoldfishState(buildGoldfishDeck(deck), {
      format: "commander",
      rng: seededRng("kira-1"),
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const t1 = mustStep(start.value, { kind: "next_turn" }, opts);
    const castKira = mustStep(
      t1,
      { kind: "cast", key: "c1", from: "commandZone", strict: false },
      opts,
    );
    const bearer = castKira.hand[0];
    const castBearer = mustStep(castKira, { kind: "cast", key: bearer.key, strict: false }, opts);
    expect(castBearer.battlefield[1].tempModifiers).toEqual([
      { kind: "pt", power: 1, toughness: 1 },
    ]);

    const t2 = mustStep(castBearer, { kind: "next_turn" }, opts);
    const attacked = mustStep(t2, { kind: "attack", keys: [bearer.key], opponentCount: 3 }, opts);
    const tokens = attacked.battlefield.filter((p) => p.card.isToken);
    expect(tokens).toHaveLength(2);
    expect(tokens.every((t) => t.tapped && t.abilities?.includes("attacking"))).toBe(true);
    expect(tokens.every((t) => t.tempModifiers?.[0]?.power === 1)).toBe(true);

    const afterCombat = mustStep(attacked, { kind: "end_combat" }, opts);
    expect(afterCombat.battlefield.filter((p) => p.card.isToken)).toHaveLength(0);
    expect(afterCombat.battlefield).toHaveLength(2);

    const afterEnd = mustStep(afterCombat, { kind: "end_step" }, opts);
    expect(afterEnd.battlefield.every((p) => p.tempModifiers === undefined)).toBe(true);
  });

  it("allows haste mana dorks to tap for mana on the turn they enter, while blocking summoning-sick ones", () => {
    const deck: GoldfishDeckLine[] = [
      {
        oracleId: "llanowar",
        name: "Llanowar Elves",
        printingId: "p-llanowar",
        board: "main",
        quantity: 4,
        typeLine: "Creature — Elf Druid",
        manaCost: "{G}",
        manaValue: 1,
        text: "{T}: Add {G}.",
        producedMana: ["G"],
      },
      {
        oracleId: "haste-dork",
        name: "Haste Mana Dork",
        printingId: "p-haste-dork",
        board: "main",
        quantity: 4,
        typeLine: "Creature — Elf",
        manaCost: "{G}",
        manaValue: 1,
        text: "Haste\n{T}: Add {G}.",
        producedMana: ["G"],
      },
    ];

    const start = startGoldfishState(buildGoldfishDeck(deck), {
      format: "standard",
      rng: seededRng("haste-1"),
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    let state = mustStep(start.value, { kind: "next_turn" });

    const sick = findCardByName(state.hand, "Llanowar Elves");
    const hasty = findCardByName(state.hand, "Haste Mana Dork");

    state = mustStep(state, { kind: "cast", key: sick.key, strict: false });
    state = mustStep(state, { kind: "cast", key: hasty.key, strict: false });

    state = mustStep(state, { kind: "tap", key: sick.key });
    expect(state.manaPool.G).toBe(0);

    state = mustStep(state, { kind: "tap", key: hasty.key });
    expect(state.manaPool.G).toBe(1);
  });

  it("simulates Ornithopter ({0}) + Ashnod's Altar sacrifice-for-mana + Undying synergy", () => {
    const deck: GoldfishDeckLine[] = [
      {
        oracleId: "thopter",
        name: "Ornithopter",
        printingId: "p-thopter",
        board: "main",
        quantity: 3,
        typeLine: "Artifact Creature — Thopter",
        manaCost: "{0}",
        manaValue: 0,
        text: "Flying",
      },
      {
        oracleId: "altar",
        name: "Ashnod's Altar",
        printingId: "p-altar",
        board: "main",
        quantity: 2,
        typeLine: "Artifact",
        manaCost: "{3}",
        manaValue: 3,
        text: "Sacrifice a creature: Add {C}{C}.",
      },
      {
        oracleId: "mind-stone",
        name: "Mind Stone",
        printingId: "p-mind-stone",
        board: "main",
        quantity: 2,
        typeLine: "Artifact",
        manaCost: "{2}",
        manaValue: 2,
        text: "{T}: Add {C}.",
      },
      {
        oracleId: "undying-wolf",
        name: "Young Wolf",
        printingId: "p-wolf",
        board: "main",
        quantity: 2,
        typeLine: "Creature — Wolf",
        manaCost: "{G}",
        manaValue: 1,
        text: "Undying",
      },
    ];

    const start = startGoldfishState(buildGoldfishDeck(deck), {
      format: "standard",
      rng: seededRng("altar-1"),
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    let s = mustStep(start.value, { kind: "next_turn" });

    const allHand = [...s.hand, ...s.library];
    const thopter = findCardByName(allHand, "Ornithopter");
    const altar = findCardByName(allHand, "Ashnod's Altar");
    const mindStone = findCardByName(allHand, "Mind Stone");
    const wolf = findCardByName(allHand, "Young Wolf");

    for (const c of [thopter, altar, mindStone, wolf]) {
      if (s.library.some((x) => x.key === c.key)) {
        s = mustStep(s, { kind: "move", key: c.key, from: "library", to: "hand" });
      }
    }

    s = mustStep(s, { kind: "cast", key: altar.key, strict: false });
    s = mustStep(s, { kind: "cast", key: thopter.key, strict: true });

    s = mustStep(s, { kind: "activate", key: altar.key, sacrificeKey: thopter.key });
    expect(s.manaPool.C).toBe(2);
    expect(s.graveyard.some((c) => c.key === thopter.key)).toBe(true);

    s = mustStep(s, { kind: "cast", key: mindStone.key, strict: true });
    expect(s.manaPool.C).toBe(0);

    s = mustStep(s, { kind: "cast", key: wolf.key, strict: false });
    s = mustStep(s, { kind: "activate", key: altar.key, sacrificeKey: wolf.key });
    expect(s.manaPool.C).toBe(2);
    const returnedWolf = s.battlefield.find((p) => p.card.key === wolf.key);
    expect(returnedWolf).toBeDefined();
    expect(returnedWolf?.counters?.["+1/+1"]).toBe(1);
  });

  it("respects CR 513.1a next-end-step timing (main phase returns this end step; end step waits for next turn)", () => {
    const deck: GoldfishDeckLine[] = [
      {
        oracleId: "avacyn",
        name: "Avacyn, Guardian Angel",
        printingId: "p-avacyn",
        board: "main",
        quantity: 4,
        typeLine: "Legendary Creature — Angel",
        manaCost: "{2}{W}{W}{W}",
        manaValue: 5,
        text: "When this creature dies, return it to the battlefield at the beginning of the next end step.",
      },
      {
        oracleId: "altar",
        name: "Ashnod's Altar",
        printingId: "p-altar",
        board: "main",
        quantity: 4,
        typeLine: "Artifact",
        manaCost: "{3}",
        manaValue: 3,
        text: "Sacrifice a creature: Add {C}{C}.",
      },
    ];

    const delayedReturnOnDies: TriggerHandler = {
      id: "delayed_return_next_end_step",
      handles: (event) =>
        event.kind === "ZoneChanged" &&
        event.from === "battlefield" &&
        event.to === "graveyard" &&
        /return it to the battlefield at the beginning of the next end step/i.test(
          event.card.text ?? "",
        ),
      run(event, state) {
        if (event.kind !== "ZoneChanged") return { state };
        const dueTurn = state.phase === "end_step" ? state.turn + 1 : state.turn;
        return {
          state: {
            ...state,
            endStepQueue: [
              ...state.endStepQueue,
              { key: event.card.key, kind: "return_to_battlefield", dueTurn },
            ],
          },
        };
      },
    };

    const opts: StepGoldfishOptions = {
      triggerHandlers: [...DEFAULT_TRIGGER_HANDLERS, delayedReturnOnDies],
    };

    const start = startGoldfishState(buildGoldfishDeck(deck), {
      format: "commander",
      rng: seededRng("avacyn-1"),
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    let s = mustStep(start.value, { kind: "next_turn" }, opts);
    const avacyn = findCardByName(s.hand, "Avacyn, Guardian Angel");
    const altar = findCardByName(s.hand, "Ashnod's Altar");

    s = mustStep(s, { kind: "cast", key: avacyn.key, strict: false }, opts);
    s = mustStep(s, { kind: "cast", key: altar.key, strict: false }, opts);

    // Case A: Sacrificed in main phase (Turn 1) -> returns at Turn 1's end step
    s = mustStep(s, { kind: "activate", key: altar.key, sacrificeKey: avacyn.key }, opts);
    expect(s.graveyard.some((c) => c.key === avacyn.key)).toBe(true);
    expect(s.endStepQueue[0]?.dueTurn).toBe(1);

    s = mustStep(s, { kind: "end_step" }, opts);
    expect(s.battlefield.some((p) => p.card.key === avacyn.key)).toBe(true);
    expect(s.phase).toBe("end_step");

    // Case B: Sacrificed DURING Turn 1's end step -> scheduled for Turn 2's end step
    s = mustStep(s, { kind: "activate", key: altar.key, sacrificeKey: avacyn.key }, opts);
    expect(s.graveyard.some((c) => c.key === avacyn.key)).toBe(true);
    expect(s.endStepQueue[0]?.dueTurn).toBe(2);

    s = mustStep(s, { kind: "next_turn" }, opts);
    expect(s.turn).toBe(2);
    expect(s.graveyard.some((c) => c.key === avacyn.key)).toBe(true);

    s = mustStep(s, { kind: "end_step" }, opts);
    expect(s.battlefield.some((p) => p.card.key === avacyn.key)).toBe(true);
  });

  it("enforces vigilance, defender, tap status, Rest in Peace replacement, Exploration, and counter annihilation", () => {
    const deck: GoldfishDeckLine[] = [
      {
        oracleId: "vigilant-dork",
        name: "Vigilant Mana Elf",
        printingId: "p-velf",
        board: "main",
        quantity: 2,
        typeLine: "Creature — Elf",
        manaCost: "{G}",
        manaValue: 1,
        text: "Vigilance\n{T}: Add {G}.",
        producedMana: ["G"],
      },
      {
        oracleId: "wall",
        name: "Wall of Roots",
        printingId: "p-wall",
        board: "main",
        quantity: 2,
        typeLine: "Creature — Plant Wall",
        manaCost: "{1}{G}",
        manaValue: 2,
        text: "Defender",
      },
      {
        oracleId: "exploration",
        name: "Exploration",
        printingId: "p-exp",
        board: "main",
        quantity: 2,
        typeLine: "Enchantment",
        manaCost: "{G}",
        manaValue: 1,
        text: "You may play an additional land on each of your turns.",
      },
      {
        oracleId: "forest",
        name: "Forest",
        printingId: "p-forest",
        board: "main",
        quantity: 4,
        typeLine: "Basic Land — Forest",
        manaValue: 0,
        producedMana: ["G"],
      },
      {
        oracleId: "rip",
        name: "Rest in Peace",
        printingId: "p-rip",
        board: "main",
        quantity: 2,
        typeLine: "Enchantment",
        manaCost: "{1}{W}",
        manaValue: 2,
        text: "If a card or token would be put into a graveyard from anywhere, exile it instead.",
      },
      {
        oracleId: "wolf",
        name: "Young Wolf",
        printingId: "p-wolf",
        board: "main",
        quantity: 2,
        typeLine: "Creature — Wolf",
        manaCost: "{G}",
        manaValue: 1,
        text: "Undying",
      },
    ];

    const ripReplacement: ZoneChangeReplacement = {
      id: "rip_graveyard_to_exile",
      applies: (intent, state) =>
        intent.to === "graveyard" &&
        state.battlefield.some((p) =>
          /would be put into a graveyard from anywhere, exile it instead/i.test(p.card.text ?? ""),
        ),
      replace: (intent) => ({ ...intent, to: "exile" }),
    };

    const opts: StepGoldfishOptions = { zoneReplacements: [ripReplacement] };
    const start = startGoldfishState(buildGoldfishDeck(deck), {
      format: "commander",
      rng: seededRng("edge-1"),
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    let state = mustStep(start.value, { kind: "next_turn" }, opts);

    for (const c of [...state.library]) {
      state = mustStep(state, { kind: "move", key: c.key, from: "library", to: "hand" }, opts);
    }

    const vElf = findCardByName(state.hand, "Vigilant Mana Elf");
    const wall = findCardByName(state.hand, "Wall of Roots");
    const exp = findCardByName(state.hand, "Exploration");
    const rip = findCardByName(state.hand, "Rest in Peace");
    const wolf = findCardByName(state.hand, "Young Wolf");
    const forests = state.hand.filter((c) => c.name === "Forest");

    for (const c of [vElf, wall, exp, rip, wolf]) {
      state = mustStep(state, { kind: "cast", key: c.key, strict: false }, opts);
    }

    state = mustStep(state, { kind: "play_land", key: forests[0].key }, opts);
    state = mustStep(state, { kind: "play_land", key: forests[1].key }, opts);
    const land3 = stepGoldfishState(state, { kind: "play_land", key: forests[2].key }, opts);
    expect(land3.ok).toBe(false);

    state = mustStep(state, { kind: "next_turn" }, opts);

    const wallAttack = stepGoldfishState(state, { kind: "attack", keys: [wall.key] }, opts);
    expect(wallAttack.ok).toBe(false);

    state = mustStep(state, { kind: "attack", keys: [vElf.key] }, opts);
    expect(state.battlefield.find((p) => p.card.key === vElf.key)?.tapped).toBe(false);

    state = mustStep(state, { kind: "tap", key: vElf.key }, opts);
    expect(state.manaPool.G).toBe(1);

    state = mustStep(
      state,
      { kind: "move", key: wolf.key, from: "battlefield", to: "graveyard" },
      opts,
    );
    expect(state.exile.some((c) => c.key === wolf.key)).toBe(true);
    expect(state.battlefield.some((p) => p.card.key === wolf.key)).toBe(false);

    const withCounters = {
      ...state,
      battlefield: state.battlefield.map((p) =>
        p.card.key === vElf.key ? { ...p, counters: { "+1/+1": 2, "-1/-1": 1 } } : p,
      ),
    };
    const sba = runStateBasedActions(withCounters);
    expect(sba.battlefield.find((p) => p.card.key === vElf.key)?.counters).toEqual({ "+1/+1": 1 });
  });

  it("models Muldrotha graveyard per-type-per-turn permissions and mill", () => {
    const deck: GoldfishDeckLine[] = [
      {
        oracleId: "muldrotha",
        name: "Muldrotha, the Gravetide",
        printingId: "p-muld",
        board: "commander",
        quantity: 1,
        typeLine: "Legendary Creature — Elemental Avatar",
        manaCost: "{3}{B}{G}{U}",
        manaValue: 6,
        text: "During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard.",
      },
      {
        oracleId: "strix",
        name: "Baleful Strix",
        printingId: "p-strix",
        board: "main",
        quantity: 3,
        typeLine: "Artifact Creature — Bird",
        manaCost: "{U}{B}",
        manaValue: 2,
      },
      {
        oracleId: "sol",
        name: "Sol Ring",
        printingId: "p-sol",
        board: "main",
        quantity: 3,
        typeLine: "Artifact",
        manaCost: "{1}",
        manaValue: 1,
      },
    ];

    const start = startGoldfishState(buildGoldfishDeck(deck), {
      format: "commander",
      rng: seededRng("muld-1"),
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    let s = mustStep(start.value, { kind: "next_turn" });
    s = mustStep(s, { kind: "cast", key: "c1", from: "commandZone", strict: false });

    for (const c of [...s.hand]) {
      s = mustStep(s, { kind: "move", key: c.key, from: "hand", to: "graveyard" });
    }

    const gyCreatures = s.graveyard.filter((c) => /\bCreature\b/i.test(c.typeLine));
    const gyArtifactOnly = s.graveyard.find(
      (c) => /\bArtifact\b/i.test(c.typeLine) && !/\bCreature\b/i.test(c.typeLine),
    );
    expect(gyCreatures.length).toBeGreaterThanOrEqual(2);
    expect(gyArtifactOnly).toBeDefined();

    s = mustStep(s, { kind: "cast", key: gyCreatures[0].key, from: "graveyard", strict: false });
    s = mustStep(s, { kind: "cast", key: gyCreatures[1].key, from: "graveyard", strict: false });

    if (gyArtifactOnly) {
      const blockedArt = stepGoldfishState(s, {
        kind: "cast",
        key: gyArtifactOnly.key,
        from: "graveyard",
        strict: false,
      });
      expect(blockedArt.ok).toBe(false);
      if (!blockedArt.ok) expect(blockedArt.error.kind).toBe("CastNotAllowed");

      const t2 = mustStep(s, { kind: "next_turn" });
      const t2Cast = stepGoldfishState(t2, {
        kind: "cast",
        key: gyArtifactOnly.key,
        from: "graveyard",
        strict: false,
      });
      expect(t2Cast.ok).toBe(true);
    }
  });

  it("models Eldrazi Unbound (Tron + Forsaken Monument + Zhulodok Cascade + Mystic Forge)", () => {
    const deck: GoldfishDeckLine[] = [
      {
        oracleId: "zhulodok",
        name: "Zhulodok, Void Gorger",
        printingId: "p-zhu",
        board: "commander",
        quantity: 1,
        typeLine: "Legendary Creature — Eldrazi",
        manaCost: "{5}{C}",
        manaValue: 6,
        text: 'Colorless spells you cast from your hand with mana value 7 or greater have "cascade, cascade."',
      },
      {
        oracleId: "monument",
        name: "Forsaken Monument",
        printingId: "p-mon",
        board: "main",
        quantity: 1,
        typeLine: "Legendary Artifact",
        manaCost: "{5}",
        manaValue: 5,
        text: "Whenever you tap a permanent for {C}, add an additional {C}.",
      },
      {
        oracleId: "forge",
        name: "Mystic Forge",
        printingId: "p-forge",
        board: "main",
        quantity: 1,
        typeLine: "Artifact",
        manaCost: "{4}",
        manaValue: 4,
        text: "You may look at the top card of your library any time. You may cast artifact spells and colorless spells from the top of your library.",
      },
      {
        oracleId: "mine",
        name: "Urza's Mine",
        printingId: "p-mine",
        board: "main",
        quantity: 1,
        typeLine: "Land — Urza's Mine",
        manaValue: 0,
        text: "{T}: Add {C}. If you control an Urza's Power-Plant and an Urza's Tower, add {C}{C} instead.",
      },
      {
        oracleId: "plant",
        name: "Urza's Power Plant",
        printingId: "p-plant",
        board: "main",
        quantity: 1,
        typeLine: "Land — Urza's Power-Plant",
        manaValue: 0,
        text: "{T}: Add {C}. If you control an Urza's Mine and an Urza's Tower, add {C}{C} instead.",
      },
      {
        oracleId: "tower",
        name: "Urza's Tower",
        printingId: "p-tower",
        board: "main",
        quantity: 1,
        typeLine: "Land — Urza's Tower",
        manaValue: 0,
        text: "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead.",
      },
      {
        oracleId: "bane",
        name: "Bane of Bala Ged",
        printingId: "p-bane",
        board: "main",
        quantity: 1,
        typeLine: "Creature — Eldrazi",
        manaCost: "{7}",
        manaValue: 7,
      },
      {
        oracleId: "mind-stone",
        name: "Mind Stone",
        printingId: "p-stone",
        board: "main",
        quantity: 8,
        typeLine: "Artifact",
        manaCost: "{2}",
        manaValue: 2,
        text: "{T}: Add {C}.",
      },
    ];

    const start = startGoldfishState(buildGoldfishDeck(deck), {
      format: "commander",
      rng: seededRng("eldrazi-1"),
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    let s = mustStep(start.value, { kind: "next_turn" });

    const allCards = [...s.hand, ...s.library];
    for (const name of [
      "Forsaken Monument",
      "Mystic Forge",
      "Urza's Mine",
      "Urza's Power Plant",
      "Urza's Tower",
    ]) {
      const c = findCardByName(allCards, name);
      if (s.library.some((x) => x.key === c.key)) {
        s = mustStep(s, { kind: "move", key: c.key, from: "library", to: "hand" });
      }
      s = c.isLand
        ? mustStep(s, { kind: "play_land", key: c.key, ignoreLandLimit: true })
        : mustStep(s, { kind: "cast", key: c.key, strict: false });
    }
    s = mustStep(s, { kind: "cast", key: "c1", from: "commandZone", strict: false });

    const tower = s.battlefield.find((p) => p.card.name === "Urza's Tower");
    expect(tower).toBeDefined();
    if (!tower) return;
    s = mustStep(s, { kind: "tap", key: tower.card.key });
    expect(s.manaPool.C).toBe(4);

    const bane = findCardByName([...s.hand, ...s.library], "Bane of Bala Ged");
    if (s.library.some((x) => x.key === bane.key)) {
      s = mustStep(s, { kind: "move", key: bane.key, from: "library", to: "hand" });
    }
    const bfBefore = s.battlefield.length;
    s = mustStep(s, { kind: "cast", key: bane.key, strict: false });
    expect(s.battlefield.length).toBeGreaterThan(bfBefore + 1);

    const topCard = s.library[0];
    if (topCard) {
      const castTop = stepGoldfishState(s, {
        kind: "cast",
        key: topCard.key,
        from: "library",
        strict: false,
      });
      expect(castTop.ok).toBe(true);
    }
  });

  it("enforces CR 704.5m/p attachment SBAs and CR 903.8 per-commander Partner tax", () => {
    const deck: GoldfishDeckLine[] = [
      {
        oracleId: "partner-a",
        name: "Partner A",
        printingId: "p-a",
        board: "commander",
        quantity: 1,
        typeLine: "Legendary Creature — Elf",
        manaCost: "{1}{G}",
        manaValue: 2,
      },
      {
        oracleId: "partner-b",
        name: "Partner B",
        printingId: "p-b",
        board: "commander",
        quantity: 1,
        typeLine: "Legendary Creature — Human",
        manaCost: "{1}{W}",
        manaValue: 2,
      },
      {
        oracleId: "greaves",
        name: "Lightning Greaves",
        printingId: "p-greaves",
        board: "main",
        quantity: 2,
        typeLine: "Artifact — Equipment",
        manaCost: "{2}",
        manaValue: 2,
        text: "Equipped creature has haste and shroud.",
      },
      {
        oracleId: "aura",
        name: "Rancor",
        printingId: "p-rancor",
        board: "main",
        quantity: 2,
        typeLine: "Enchantment — Aura",
        manaCost: "{G}",
        manaValue: 1,
        text: "Enchant creature",
      },
      {
        oracleId: "dork",
        name: "Llanowar Elves",
        printingId: "p-elves",
        board: "main",
        quantity: 4,
        typeLine: "Creature — Elf Druid",
        manaCost: "{G}",
        manaValue: 1,
        text: "{T}: Add {G}.",
        producedMana: ["G"],
      },
    ];

    const start = startGoldfishState(buildGoldfishDeck(deck), {
      format: "commander",
      rng: seededRng("partner-1"),
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    let s = mustStep(start.value, { kind: "next_turn" });

    s = mustStep(s, { kind: "cast", key: "c1", from: "commandZone", strict: false });
    expect(s.commandCastsByKey?.c1).toBe(1);
    expect(s.commandCastsByKey?.c2 ?? 0).toBe(0);

    const all = [...s.hand, ...s.library];
    const greaves = findCardByName(all, "Lightning Greaves");
    const rancor = findCardByName(all, "Rancor");
    const elves = findCardByName(all, "Llanowar Elves");
    for (const c of [greaves, rancor, elves]) {
      if (s.library.some((x) => x.key === c.key)) {
        s = mustStep(s, { kind: "move", key: c.key, from: "library", to: "hand" });
      }
      s = mustStep(s, { kind: "cast", key: c.key, strict: false });
    }

    s = mustStep(s, { kind: "attach", key: greaves.key, targetKey: elves.key });
    s = mustStep(s, { kind: "attach", key: rancor.key, targetKey: elves.key });

    s = mustStep(s, { kind: "tap", key: elves.key });
    expect(s.manaPool.G).toBe(1);

    s = mustStep(s, { kind: "move", key: elves.key, from: "battlefield", to: "graveyard" });
    expect(s.graveyard.some((c) => c.key === rancor.key)).toBe(true);
    const greavesAfter = s.battlefield.find((p) => p.card.key === greaves.key);
    expect(greavesAfter).toBeDefined();
    expect(greavesAfter?.attachedTo).toBeUndefined();
  });
});
