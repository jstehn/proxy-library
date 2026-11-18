import { describe, expect, it } from "vitest";
import { extractCrVersion, parseComprehensiveRules } from "./comprehensive-rules";

const SAMPLE_CR = `Magic: The Gathering Comprehensive Rules

These rules are effective as of September 1, 2026.

Contents
1. Game Concepts
100. General
702. Keyword Abilities
Glossary
Credits

1. Game Concepts

100. General

100.1. These Magic rules apply to any Magic game with two or more players, including two-player games and multiplayer games.

100.1a A two-player game is a game that begins with only two players.

702. Keyword Abilities

702.19. Trample

702.19a Trample is a static ability that modifies the rules for assigning an attacking creature's combat damage.
Example: A 4/4 creature with trample is blocked by a 2/2 creature.

Glossary

Trample
A keyword ability that lets an attacking creature deal excess combat damage to the player or planeswalker it is attacking.

Ward
A triggered ability that counters a spell or ability unless its controller pays a cost.

Credits
Wizards of the Coast
`;

describe("comprehensive-rules parser", () => {
  it("extracts effective date as ISO version", () => {
    expect(extractCrVersion(SAMPLE_CR)).toBe("2026-09-01");
    expect(extractCrVersion("no date here")).toBe("unknown");
  });

  it("parses sections, rules, subrules, continuation lines, and glossary while skipping TOC", () => {
    const parsed = parseComprehensiveRules(SAMPLE_CR);
    expect(parsed.version).toBe("2026-09-01");

    const byId = new Map(parsed.rules.map((r) => [r.ruleNumber, r]));
    expect(byId.get("100.1")?.kind).toBe("rule");
    expect(byId.get("100.1")?.section).toBe("100. General");
    expect(byId.get("100.1a")?.parentNumber).toBe("100.1");

    expect(byId.get("702.19")?.title).toBe("Trample");
    expect(byId.get("702.19a")?.text).toContain("Example: A 4/4 creature with trample");

    expect(byId.get("glossary:trample")?.kind).toBe("glossary");
    expect(byId.get("glossary:trample")?.title).toBe("Trample");
    expect(byId.get("glossary:ward")?.text).toContain("counters a spell or ability");
    expect(byId.has("Credits")).toBe(false);
  });

  it("is idempotent and produces unique ruleNumbers", () => {
    const a = parseComprehensiveRules(SAMPLE_CR);
    const b = parseComprehensiveRules(SAMPLE_CR);
    expect(a).toEqual(b);
    const keys = a.rules.map((r) => r.ruleNumber);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
