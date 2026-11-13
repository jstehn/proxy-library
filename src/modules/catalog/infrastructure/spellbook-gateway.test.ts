import { describe, expect, it } from "vitest";
import { parseManaNeededValue, parseSpellbookVariantsJson } from "./spellbook-gateway";

describe("parseManaNeededValue", () => {
  it("sums generic and colored mana symbols while treating X as 0", () => {
    expect(parseManaNeededValue("{U}{U}{B}")).toBe(3);
    expect(parseManaNeededValue("{4}{R}")).toBe(5);
    expect(parseManaNeededValue("{X}{G}{G}")).toBe(2);
    expect(parseManaNeededValue(null)).toBeNull();
  });
});

describe("parseSpellbookVariantsJson", () => {
  it("filters to Commander-legal two-card combos with oracleIds and canonicalizes pairs", () => {
    const combos = parseSpellbookVariantsJson({
      variants: [
        {
          id: "100",
          bracketTag: "R",
          manaNeeded: "{U}{U}{B}",
          legalities: { commander: true },
          uses: [
            { quantity: 1, card: { name: "Thassa's Oracle", oracleId: "zzz-oracle" } },
            { quantity: 1, card: { name: "Demonic Consultation", oracleId: "aaa-consult" } },
          ],
          produces: [{ feature: { name: "Win the game" } }],
        },
        {
          id: "101",
          bracketTag: "S",
          manaNeeded: "{4}{R}",
          uses: [
            { quantity: 1, card: { name: "Kiki-Jiki, Mirror Breaker", oracleId: "kiki" } },
            { quantity: 1, card: { name: "Zealous Conscripts", oracleId: "zealous" } },
          ],
          produces: [{ feature: { name: "Infinite creature tokens" } }],
        },
        // 3-card combo -> excluded
        {
          id: "102",
          uses: [
            { quantity: 1, card: { name: "A", oracleId: "a" } },
            { quantity: 1, card: { name: "B", oracleId: "b" } },
            { quantity: 1, card: { name: "C", oracleId: "c" } },
          ],
        },
        // Illegal in Commander -> excluded
        {
          id: "103",
          legalities: { commander: false },
          uses: [
            { quantity: 1, card: { name: "X", oracleId: "x" } },
            { quantity: 1, card: { name: "Y", oracleId: "y" } },
          ],
        },
        // Missing oracleId -> excluded
        {
          id: "104",
          uses: [
            { quantity: 1, card: { name: "X", oracleId: "x" } },
            { quantity: 1, card: { name: "Token", oracleId: null } },
          ],
        },
      ],
    });

    expect(combos).toEqual([
      {
        id: "100",
        oracleIdA: "aaa-consult",
        oracleIdB: "zzz-oracle",
        cardNameA: "Demonic Consultation",
        cardNameB: "Thassa's Oracle",
        produces: ["Win the game"],
        bracketTag: "R",
        manaValue: 3,
        forcesBracket: 4,
      },
      {
        id: "101",
        oracleIdA: "kiki",
        oracleIdB: "zealous",
        cardNameA: "Kiki-Jiki, Mirror Breaker",
        cardNameB: "Zealous Conscripts",
        produces: ["Infinite creature tokens"],
        bracketTag: "S",
        manaValue: 5,
        forcesBracket: 3,
      },
    ]);
  });
});
