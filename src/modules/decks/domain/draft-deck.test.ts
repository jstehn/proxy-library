import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { draftDeck, type DeckDraft, type DraftCandidate, type DraftInput } from "./draft-deck";
import type { LandCandidate } from "./mana-base";
import type { ManaColor } from "./stats";
import type { ProfileLine } from "./suggest";

// Draft a 100-card Commander deck from owned cards first (design doc 37, sections 3-4).

const commanderLine = (overrides: Partial<ProfileLine> = {}): ProfileLine => ({
  quantity: 1,
  manaValue: 4,
  manaCost: "{2}{B}{G}",
  typeLine: "Legendary Creature — Human Shaman",
  board: "commander",
  text: "Whenever another creature you control dies, create a 1/1 green Saproling creature token.",
  keywords: [],
  ...overrides,
});

const candidate = (name: string, overrides: Partial<DraftCandidate> = {}): DraftCandidate => ({
  oracleId: name,
  name,
  typeLine: "Creature — Elf",
  manaCost: "{1}{G}",
  manaValue: 2,
  text: "",
  producedMana: [],
  keywords: [],
  roles: [],
  themes: [],
  rarity: "common",
  priceCents: 50,
  pool: "owned",
  ownedCopies: 1,
  alsoIn: [],
  ...overrides,
});

const manyCandidates = (
  count: number,
  overrides: Partial<DraftCandidate> = {},
  prefix = "Spell",
): DraftCandidate[] =>
  Array.from({ length: count }, (_, index) =>
    candidate(`${prefix} ${String(index).padStart(2, "0")}`, overrides),
  );

const land = (name: string, overrides: Partial<LandCandidate> = {}): LandCandidate => ({
  oracleId: name,
  name,
  typeLine: "Land",
  text: "",
  producedMana: [],
  isBasicLand: false,
  ownedCopies: 1,
  alsoIn: [],
  priceCents: null,
  roles: [],
  themes: [],
  ...overrides,
});

const BASIC_NAMES: Readonly<Record<ManaColor | "C", string>> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
  C: "Wastes",
};

const BASICS: LandCandidate[] = Object.entries(BASIC_NAMES).map(([color, name]) =>
  land(name, {
    typeLine: `Basic Land — ${name}`,
    producedMana: [color],
    isBasicLand: true,
  }),
);

const runDraft = (overrides: Partial<DraftInput> = {}): DeckDraft =>
  draftDeck({
    format: "commander",
    lines: [commanderLine()],
    inDeck: new Map([["Commander", 1]]),
    candidates: [],
    ownedLands: [],
    basics: BASICS,
    storeLands: [],
    ...overrides,
  });

describe("draftDeck", () => {
  it("reaches 100 cards from a 1-commander deck using owned cards and satisfies role targets", () => {
    const ownedPool: DraftCandidate[] = [
      ...manyCandidates(12, { roles: ["ramp"], manaCost: "{1}{G}", manaValue: 2 }, "Ramp"),
      ...manyCandidates(12, { roles: ["draw"], manaCost: "{2}{B}", manaValue: 3 }, "Draw"),
      ...manyCandidates(10, { roles: ["removal"], manaCost: "{1}{B}", manaValue: 2 }, "Removal"),
      ...manyCandidates(4, { roles: ["wipe"], manaCost: "{2}{B}{B}", manaValue: 4 }, "Wipe"),
      ...manyCandidates(30, { themes: ["tokens"], manaCost: "{2}{G}", manaValue: 3 }, "Token"),
      ...manyCandidates(20, { manaCost: "{3}{G}", manaValue: 4 }, "Curve"),
    ];

    const draft = runDraft({ candidates: ownedPool });

    const landsAdded = draft.manaBase.add.reduce((sum, entry) => sum + entry.quantity, 0);
    expect(draft.existingCount).toBe(1);
    expect(draft.spells.length + landsAdded).toBe(99);
    expect(draft.totalAfterDraft).toBe(100);
    expect(draft.storeAddedCount).toBe(0);
    expect(draft.storeCostCents).toBe(0);

    for (const role of draft.roleSummary) {
      expect(role.total).toBeGreaterThanOrEqual(role.target);
      expect(role.storeAdded).toBe(0);
    }
  });

  it("picks all owned cards for a role before pulling store cards, and sums storeCostCents", () => {
    const candidates: DraftCandidate[] = [
      ...manyCandidates(6, { roles: ["ramp"], pool: "owned", ownedCopies: 1 }, "Owned Ramp"),
      ...manyCandidates(
        10,
        { roles: ["ramp"], pool: "store", ownedCopies: 0, priceCents: 125 },
        "Store Ramp",
      ),
      ...manyCandidates(10, { roles: ["draw"] }, "Owned Draw"),
      ...manyCandidates(8, { roles: ["removal"] }, "Owned Removal"),
      ...manyCandidates(3, { roles: ["wipe"] }, "Owned Wipe"),
      ...manyCandidates(40, { themes: ["tokens"] }, "Owned Token"),
    ];

    const draft = runDraft({ candidates });

    const rampPicks = draft.spells.filter((spell) => spell.primaryRole === "ramp");
    expect(rampPicks).toHaveLength(10);
    expect(rampPicks.slice(0, 6).every((spell) => spell.pool === "owned")).toBe(true);
    expect(rampPicks.slice(6).every((spell) => spell.pool === "store")).toBe(true);
    expect(draft.storeAddedCount).toBe(4);
    expect(draft.storeCostCents).toBe(4 * 125);
  });

  it("prefers cheaper store cards when fit points are equal", () => {
    const candidates: DraftCandidate[] = [
      candidate("Expensive Wipe", {
        roles: ["wipe"],
        pool: "store",
        ownedCopies: 0,
        rarity: "mythic",
        priceCents: 4000,
      }),
      candidate("Budget Wipe", {
        roles: ["wipe"],
        pool: "store",
        ownedCopies: 0,
        rarity: "rare",
        priceCents: 75,
      }),
      ...manyCandidates(65, { themes: ["tokens"], typeLine: "Artifact" }, "Owned Token"),
    ];

    const draft = runDraft({
      candidates,
      options: { roleTargets: { ramp: 0, draw: 0, removal: 0, wipe: 1 } },
    });

    expect(draft.spells[0]?.name).toBe("Budget Wipe");
    expect(draft.storeAddedCount).toBe(1);
    expect(draft.storeCostCents).toBe(75);
  });

  it("counts a multi-role card toward all of its roles so roles are not over-drafted", () => {
    const candidates: DraftCandidate[] = [
      ...manyCandidates(
        10,
        { roles: ["ramp", "draw"], manaCost: "{2}{G}", manaValue: 3, typeLine: "Artifact" },
        "RampAndDraw",
      ),
      ...manyCandidates(10, { roles: ["ramp"], typeLine: "Artifact" }, "OnlyRamp"),
      ...manyCandidates(10, { roles: ["draw"], typeLine: "Artifact" }, "OnlyDraw"),
    ];

    const draft = runDraft({
      candidates,
      options: { roleTargets: { ramp: 10, draw: 10, removal: 0, wipe: 0 } },
    });

    const rolePicks = draft.spells.filter((spell) => spell.section === "role");
    expect(rolePicks).toHaveLength(10);
    expect(rolePicks.every((spell) => spell.name.startsWith("RampAndDraw"))).toBe(true);
  });

  it("never drafts store cards when includeStore is 'none'", () => {
    const candidates: DraftCandidate[] = [
      ...manyCandidates(4, { roles: ["ramp"], pool: "owned", ownedCopies: 1 }, "Owned Ramp"),
      ...manyCandidates(
        20,
        { roles: ["ramp"], pool: "store", ownedCopies: 0, priceCents: 100 },
        "Store Ramp",
      ),
      ...manyCandidates(
        40,
        { themes: ["tokens"], pool: "store", ownedCopies: 0, priceCents: 200 },
        "Store Token",
      ),
    ];

    const draft = runDraft({
      candidates,
      options: { includeStore: "none" },
    });

    expect(draft.spells.every((spell) => spell.pool === "owned")).toBe(true);
    expect(draft.storeAddedCount).toBe(0);
    expect(draft.storeCostCents).toBe(0);
    expect(draft.spells).toHaveLength(4);
  });

  it("fills remaining spell slots with owned curve cards before non-role store cards", () => {
    const candidates: DraftCandidate[] = [
      ...manyCandidates(10, { roles: ["ramp"] }, "Owned Ramp"),
      ...manyCandidates(10, { roles: ["draw"] }, "Owned Draw"),
      ...manyCandidates(8, { roles: ["removal"] }, "Owned Removal"),
      ...manyCandidates(3, { roles: ["wipe"] }, "Owned Wipe"),
      ...manyCandidates(15, { themes: ["tokens"], typeLine: "Enchantment" }, "Owned Token"),
      ...manyCandidates(25, { themes: [], roles: [], typeLine: "Artifact" }, "Owned Playable"),
      ...manyCandidates(
        30,
        { themes: ["tokens"], pool: "store", ownedCopies: 0, priceCents: 150 },
        "Store Token",
      ),
    ];

    const draft = runDraft({ candidates });

    expect(draft.totalAfterDraft).toBe(100);
    expect(draft.storeAddedCount).toBe(0);
    expect(draft.spells.some((spell) => spell.section === "curve")).toBe(true);
  });

  it("reconciles spell count with planManaBase when high curve increases land target", () => {
    const heavySpells = manyCandidates(
      75,
      { themes: ["tokens"], manaCost: "{4}{G}{G}", manaValue: 6 },
      "Colossus",
    );

    const draft = runDraft({
      candidates: heavySpells,
      options: { roleTargets: { ramp: 0, draw: 0, removal: 0, wipe: 0 } },
    });

    expect(draft.manaBase.landTarget.lands).toBe(39);
    expect(draft.spells).toHaveLength(60);
    const landsAdded = draft.manaBase.add.reduce((sum, entry) => sum + entry.quantity, 0);
    expect(landsAdded).toBe(39);
    expect(draft.totalAfterDraft).toBe(100);
  });

  it("respects existing cards in the deck and returns empty additions when already at 100", () => {
    const fullLines: ProfileLine[] = [
      commanderLine(),
      {
        quantity: 62,
        manaValue: 3,
        manaCost: "{2}{G}",
        typeLine: "Creature — Elf",
        board: "main",
      },
      {
        quantity: 37,
        manaValue: 0,
        typeLine: "Basic Land — Forest",
        board: "main",
        producedMana: ["G"],
      },
    ];

    const draft = runDraft({
      lines: fullLines,
      candidates: manyCandidates(20, { themes: ["tokens"] }),
    });

    expect(draft.existingCount).toBe(100);
    expect(draft.spells).toEqual([]);
    expect(draft.manaBase.add).toEqual([]);
    expect(draft.totalAfterDraft).toBe(100);
  });
});

describe("draftDeck properties", () => {
  const arbTag = fc.constantFrom(
    "ramp" as const,
    "draw" as const,
    "removal" as const,
    "wipe" as const,
  );
  const arbTheme = fc.constantFrom("tokens" as const, "sacrifice" as const, "counters" as const);

  const arbCandidate = fc
    .record({
      id: fc.integer({ min: 1, max: 120 }),
      manaValue: fc.integer({ min: 1, max: 7 }),
      roles: fc.uniqueArray(arbTag, { maxLength: 2 }),
      themes: fc.uniqueArray(arbTheme, { maxLength: 2 }),
      owned: fc.boolean(),
      priceCents: fc.integer({ min: 10, max: 2000 }),
    })
    .map(({ id, manaValue, roles, themes, owned, priceCents }): DraftCandidate =>
      candidate(`Card_${String(id).padStart(3, "0")}`, {
        oracleId: `oracle_${id}`,
        manaValue,
        manaCost: `{${Math.max(0, manaValue - 1)}}{G}`,
        roles,
        themes,
        pool: owned ? "owned" : "store",
        ownedCopies: owned ? 1 : 0,
        priceCents,
      }),
    );

  it("never exceeds max(100, existingCount), enforces singleton spells, and is order-independent", () => {
    fc.assert(
      fc.property(
        fc.array(arbCandidate, { minLength: 0, maxLength: 90 }),
        fc.integer({ min: 0, max: 50 }),
        fc.boolean(),
        (candidates, existingMainSpells, allowStore) => {
          const lines: ProfileLine[] = [
            commanderLine(),
            ...(existingMainSpells > 0
              ? [
                  {
                    quantity: existingMainSpells,
                    manaValue: 3,
                    manaCost: "{2}{G}",
                    typeLine: "Creature — Elf",
                    board: "main" as const,
                  },
                ]
              : []),
          ];

          const first = runDraft({
            lines,
            candidates,
            options: { includeStore: allowStore ? "fill-gaps" : "none" },
          });
          const reversed = runDraft({
            lines,
            candidates: [...candidates].reverse(),
            options: { includeStore: allowStore ? "fill-gaps" : "none" },
          });

          expect(first.totalAfterDraft).toBeLessThanOrEqual(Math.max(100, first.existingCount));

          const spellIds = first.spells.map((spell) => spell.oracleId);
          expect(new Set(spellIds).size).toBe(spellIds.length);

          if (!allowStore) {
            expect(first.spells.every((spell) => spell.pool === "owned")).toBe(true);
            expect(first.storeAddedCount).toBe(0);
          }

          expect(first.spells.map((spell) => spell.oracleId)).toEqual(
            reversed.spells.map((spell) => spell.oracleId),
          );
          expect(first.totalAfterDraft).toBe(reversed.totalAfterDraft);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("drafts 60-card decks with multi-copy playsets, 60-card role targets, and restricted caps (design doc 44)", () => {
    const ownedPool: DraftCandidate[] = [
      candidate("Elvish Mystic", {
        roles: ["ramp"],
        manaCost: "{G}",
        manaValue: 1,
        ownedCopies: 4,
      }),
      candidate("Harmonize", {
        roles: ["draw"],
        manaCost: "{2}{G}{G}",
        manaValue: 4,
        ownedCopies: 4,
      }),
      candidate("Silverback Elder", {
        roles: ["draw"],
        manaCost: "{2}{G}{G}{G}",
        manaValue: 5,
        ownedCopies: 2,
      }),
      candidate("Prey Upon", {
        roles: ["removal"],
        manaCost: "{G}",
        manaValue: 1,
        ownedCopies: 4,
      }),
      candidate("Fade into Antiquity", {
        roles: ["removal"],
        manaCost: "{2}{G}",
        manaValue: 3,
        ownedCopies: 2,
      }),
      candidate("Pest Infestation", {
        roles: ["wipe"],
        manaCost: "{X}{G}{G}",
        manaValue: 2,
        ownedCopies: 4,
      }),
      candidate("Restricted Gem", {
        typeLine: "Artifact",
        roles: ["ramp"],
        manaCost: "{0}",
        manaValue: 0,
        ownedCopies: 4,
        isRestricted: true,
      }),
      ...manyCandidates(8, { ownedCopies: 4, manaCost: "{1}{G}", manaValue: 2 }, "Bear"),
    ];

    const draft = draftDeck({
      format: "modern",
      lines: [
        {
          quantity: 1,
          manaValue: 1,
          manaCost: "{G}",
          typeLine: "Creature — Elf",
          board: "main",
          text: "",
        },
      ],
      inDeck: new Map(),
      candidates: ownedPool,
      ownedLands: [],
      basics: BASICS,
      storeLands: [],
      options: { includeStore: "none" },
    });

    expect(draft.targetTotal).toBe(60);
    expect(draft.totalAfterDraft).toBe(60);
    expect(draft.storeAddedCount).toBe(0);

    const byName = new Map(draft.spells.map((spell) => [spell.name, spell]));
    for (const spell of draft.spells) {
      expect(spell.quantity).toBeGreaterThanOrEqual(1);
      expect(spell.quantity).toBeLessThanOrEqual(spell.name === "Restricted Gem" ? 1 : 4);
    }
    expect(byName.get("Restricted Gem")?.quantity ?? 0).toBeLessThanOrEqual(1);
    expect(byName.get("Elvish Mystic")?.quantity).toBe(4);
    expect(byName.get("Prey Upon")?.quantity).toBe(4);

    // 60-card role targets are satisfied using multi-copy playsets.
    expect(draft.roleSummary).toEqual([
      { tag: "ramp", target: 4, existing: 0, ownedAdded: 4, storeAdded: 0, total: 4 },
      { tag: "draw", target: 6, existing: 0, ownedAdded: 6, storeAdded: 0, total: 6 },
      { tag: "removal", target: 6, existing: 0, ownedAdded: 6, storeAdded: 0, total: 6 },
      { tag: "wipe", target: 2, existing: 0, ownedAdded: 2, storeAdded: 0, total: 2 },
    ]);
  });

  it("respects existing copies inDeck when completing 4-card playsets in 60-card formats", () => {
    const bolt = candidate("Lightning Bolt", {
      roles: ["removal"],
      manaCost: "{R}",
      manaValue: 1,
      ownedCopies: 4,
    });
    const draft = draftDeck({
      format: "modern",
      lines: [
        {
          quantity: 2,
          manaValue: 1,
          manaCost: "{R}",
          typeLine: "Instant",
          board: "main",
          text: "Lightning Bolt deals 3 damage to any target.",
        },
      ],
      inDeck: new Map([["Lightning Bolt", 2]]),
      candidates: [
        bolt,
        ...manyCandidates(15, { ownedCopies: 4, manaCost: "{1}{R}", manaValue: 2 }, "Goblin"),
      ],
      ownedLands: [],
      basics: BASICS,
      storeLands: [],
      options: { includeStore: "none" },
    });

    const addedBolt = draft.spells.find((spell) => spell.name === "Lightning Bolt");
    expect(addedBolt?.quantity).toBe(2); // 2 already in deck + 2 drafted = 4 max playset
    expect(draft.totalAfterDraft).toBe(60);
  });
});
