import { describe, expect, it } from "vitest";
import {
  manaSymbols,
  parseColors,
  parseSearch,
  rarityName,
  toggleTerm,
  hasTerm,
  type SearchNode,
} from "./parse";

const term = (field: string, comparison: string, value: string): SearchNode =>
  ({ kind: "term", term: { field, comparison, value } }) as SearchNode;

describe("parseSearch", () => {
  it("matches everything for an empty search", () => {
    expect(parseSearch("   ")).toEqual({ node: { kind: "all" }, notes: [] });
  });

  it("reads plain words as name searches, all of which must match", () => {
    expect(parseSearch("lightning bolt").node).toEqual({
      kind: "and",
      children: [term("name", ":", "lightning"), term("name", ":", "bolt")],
    });
  });

  it("reads keywords, aliases and comparisons", () => {
    expect(parseSearch("t:creature").node).toEqual(term("type", ":", "creature"));
    expect(parseSearch("cmc>=3").node).toEqual(term("manaValue", ">=", "3"));
    expect(parseSearch("ci<=esper").node).toEqual(term("identity", "<=", "esper"));
    expect(parseSearch("pow>4").node).toEqual(term("power", ">", "4"));
    expect(parseSearch("r:m").node).toEqual(term("rarity", ":", "m"));
    expect(parseSearch("is:commander").node).toEqual(term("is", ":", "commander"));
  });

  it("keeps a quoted phrase together", () => {
    expect(parseSearch('o:"draw a card" t:instant').node).toEqual({
      kind: "and",
      children: [term("oracle", ":", "draw a card"), term("type", ":", "instant")],
    });
  });

  it("reads -, or and parentheses", () => {
    expect(parseSearch("-t:land").node).toEqual({ kind: "not", child: term("type", ":", "land") });
    expect(parseSearch("t:instant or t:sorcery").node).toEqual({
      kind: "or",
      children: [term("type", ":", "instant"), term("type", ":", "sorcery")],
    });
    expect(parseSearch("mv<=2 (c:r or c:w)").node).toEqual({
      kind: "and",
      children: [
        term("manaValue", "<=", "2"),
        { kind: "or", children: [term("color", ":", "r"), term("color", ":", "w")] },
      ],
    });
  });

  it("ignores what it can't read, says so, and runs the rest", () => {
    const parsed = parseSearch("foo:bar mv<=two c:purple t:goblin");
    expect(parsed.node).toEqual(term("type", ":", "goblin"));
    expect(parsed.notes).toEqual([
      'Unknown keyword "foo:" (ignored)',
      '"two" isn\'t a number (ignored)',
      '"purple" isn\'t a color (ignored)',
    ]);
  });

  it("copes with unbalanced parentheses", () => {
    expect(parseSearch("(t:elf").notes).toEqual([
      "A parenthesis isn't closed (treated as closed at the end)",
    ]);
    expect(parseSearch("t:elf)").node).toEqual(term("type", ":", "elf"));
  });

  it("refuses comparisons that make no sense for text", () => {
    expect(parseSearch("t>=elf").notes).toEqual(['">=" doesn\'t apply to text (ignored)']);
  });
});

describe("parseColors", () => {
  it("reads letters, names, guilds, shards and wedges", () => {
    expect(parseColors("rw")).toEqual({ kind: "colors", colors: ["R", "W"] });
    expect(parseColors("red")).toEqual({ kind: "colors", colors: ["R"] });
    expect(parseColors("Simic")).toEqual({ kind: "colors", colors: ["G", "U"] });
    expect(parseColors("esper")).toEqual({ kind: "colors", colors: ["W", "U", "B"] });
    expect(parseColors("abzan")).toEqual({ kind: "colors", colors: ["W", "B", "G"] });
    expect(parseColors("m")).toEqual({ kind: "multicolored" });
    expect(parseColors("colorless")).toEqual({ kind: "colorless" });
    expect(parseColors("purple")).toBeNull();
  });
});

describe("rarityName and manaSymbols", () => {
  it("reads rarities by letter or name", () => {
    expect(rarityName("m")).toBe("mythic");
    expect(rarityName("Uncommon")).toBe("uncommon");
    expect(rarityName("x")).toBeNull();
  });

  it("counts mana symbols, braced or not", () => {
    expect(manaSymbols("{G}{G}")).toEqual(new Map([["{G}", 2]]));
    expect(manaSymbols("2gg")).toEqual(
      new Map([
        ["{2}", 1],
        ["{G}", 2],
      ]),
    );
  });
});

describe("toggleTerm", () => {
  it("adds a term, and removes it when pressed again", () => {
    const added = toggleTerm("bolt", "t:instant");
    expect(added).toBe("bolt t:instant");
    expect(hasTerm(added, "T:Instant")).toBe(true);
    expect(toggleTerm(added, "t:instant")).toBe("bolt");
  });

  it("replaces a term of the same family", () => {
    const manaValue = /^mv[<>=:]/i;
    expect(toggleTerm('o:"draw a card" mv=2', "mv=3", manaValue)).toBe('o:"draw a card" mv=3');
    expect(toggleTerm("mv=3", "mv=3", manaValue)).toBe("");
  });
});

describe("design doc 15 keywords", () => {
  const only = (text: string) => {
    const parsed = parseSearch(text);
    return { node: parsed.node, notes: parsed.notes };
  };

  it("reads exact names with !", () => {
    expect(only('!"Lightning Bolt"').node).toEqual(term("name", "=", "Lightning Bolt"));
    expect(only("!Opt").node).toEqual(term("name", "=", "Opt"));
  });

  it("reads the new keywords, with their aliases", () => {
    expect(only("kw:flying").node).toEqual(term("keyword", ":", "flying"));
    expect(only('keyword:"first strike"').node).toEqual(term("keyword", ":", "first strike"));
    expect(only("loy>=4").node).toEqual(term("loyalty", ">=", "4"));
    expect(only("def<3").node).toEqual(term("defense", "<", "3"));
    expect(only('a:"rebecca guay"').node).toEqual(term("artist", ":", "rebecca guay"));
    expect(only("cn<=100").node).toEqual(term("number", "<=", "100"));
    expect(only("cn:12a").node).toEqual(term("number", ":", "12a"));
    expect(only("produces:gw").node).toEqual(term("produces", ":", "gw"));
    expect(only("usd<0.50").node).toEqual(term("usd", "<", "0.50"));
    expect(only("year>=2024").node).toEqual(term("year", ">=", "2024"));
    expect(only("date>=2024-08").node).toEqual(term("date", ">=", "2024-08"));
    expect(only("border:borderless").node).toEqual(term("border", ":", "borderless"));
    expect(only("frame:showcase").node).toEqual(term("frame", ":", "showcase"));
    expect(only("own=0").node).toEqual(term("own", "=", "0"));
    expect(only("free>0").node).toEqual(term("free", ">", "0"));
    expect(only("spare>=2").node).toEqual(term("free", ">=", "2"));
    for (const value of ["mdfc", "dfc", "adventure", "showcase", "fullart", "vanilla", "bear"]) {
      expect(only(`is:${value}`).notes).toEqual([]);
    }
  });

  it("reads /patterns/, keeping spaces and parentheses inside them", () => {
    expect(only("o:/draw (a|two) cards?/ t:instant").node).toEqual({
      kind: "and",
      children: [
        {
          kind: "term",
          term: { field: "oracle", comparison: ":", value: "draw (a|two) cards?", isPattern: true },
        },
        term("type", ":", "instant"),
      ],
    });
    expect(only("/^bolt/").node).toEqual({
      kind: "term",
      term: { field: "name", comparison: ":", value: "^bolt", isPattern: true },
    });
    expect(only("o:/a\\/b/").node).toMatchObject({ term: { value: "a\\/b", isPattern: true } });
  });

  it("notes patterns it won't run, and values that don't fit", () => {
    expect(only("o:/(unclosed/").notes).toEqual(["/(unclosed/ isn't a valid pattern (ignored)"]);
    expect(only(`o:/${"a".repeat(101)}/`).notes).toEqual([
      "A /pattern/ longer than 100 characters (ignored)",
    ]);
    expect(only("o:/(?<word>x)/").notes).toEqual([
      "/(?<word>x)/ uses a feature not supported (ignored)",
    ]);
    expect(only("mv:/2/").notes).toEqual(['"mv:" doesn\'t take a /pattern/ (ignored)']);
    expect(only("produces:x").notes).toEqual([
      '"x" isn\'t a mana color (W, U, B, R, G or C) (ignored)',
    ]);
    expect(only("border:plaid").notes).toHaveLength(1);
    expect(only("date>=yesterday").notes).toHaveLength(1);
    expect(only("is:sparkly").notes).toEqual([
      '"is:sparkly" isn\'t supported (see Search help) (ignored)',
    ]);
  });
});

describe("design doc 28 keywords", () => {
  const only = (text: string) => parseSearch(text);

  it("reads role tags and themes, and refuses values that aren't one", () => {
    expect(only("tag:ramp").node).toEqual(term("tag", ":", "ramp"));
    expect(only("role:draw").node).toEqual(term("tag", ":", "draw"));
    expect(only("theme:tokens").node).toEqual(term("theme", ":", "tokens"));
    expect(only("-theme:sacrifice").node).toEqual({
      kind: "not",
      child: term("theme", ":", "sacrifice"),
    });
    expect(only("tag:lifegain").notes).toEqual([
      expect.stringContaining('"tag:lifegain" isn\'t a tag'),
    ]);
    expect(only("theme:ramp").notes).toHaveLength(1);
  });

  it("reads Scryfall tagger values that mean a tag or theme, and notes the rest", () => {
    expect(only("otag:card-draw").node).toEqual(term("tag", ":", "draw"));
    expect(only("function:board-wipe").node).toEqual(term("tag", ":", "wipe"));
    expect(only("otag:removal-creature").node).toEqual(term("tag", ":", "removal"));
    expect(only("otag:sacrifice-outlet").node).toEqual(term("theme", ":", "sacrifice"));
    expect(only("otag!=ramp").node).toEqual(term("tag", "!=", "ramp"));
    const unknown = only("otag:pseudo-ramp t:creature");
    expect(unknown.node).toEqual(term("type", ":", "creature"));
    expect(unknown.notes).toEqual([
      "\"otag:pseudo-ramp\" isn't one of this app's tags; use tag:, theme: or o:/…/ (ignored)",
    ]);
  });

  it("compares two numbers on the same card", () => {
    expect(only("pow>tou").node).toEqual({
      kind: "term",
      term: { field: "power", comparison: ">", value: "toughness", compareTo: "toughness" },
    });
    expect(only("tou:pow").node).toMatchObject({
      term: { field: "toughness", comparison: "=", compareTo: "power" },
    });
    expect(only("pow>=cmc").node).toMatchObject({ term: { compareTo: "manaValue" } });
    expect(only("pow>pow").notes).toEqual(['"pow>pow" compares a number with itself (ignored)']);
  });

  it("reads even and odd mana values", () => {
    expect(only("mv:even").node).toEqual(term("manaValue", ":", "even"));
    expect(only("cmc!=odd").node).toEqual(term("manaValue", "!=", "odd"));
    expect(only("mv>even").notes).toEqual(['">" doesn\'t apply to even or odd (ignored)']);
  });

  it("reads banned, restricted and full oracle text", () => {
    expect(only("banned:commander").node).toEqual(term("banned", ":", "commander"));
    expect(only("restricted:vintage").node).toEqual(term("restricted", ":", "vintage"));
    expect(only('fo:"can\'t be blocked"').node).toEqual(
      term("fullOracle", ":", "can't be blocked"),
    );
    expect(only("fo:/flying\\)/").node).toMatchObject({
      term: { field: "fullOracle", isPattern: true },
    });
    expect(only("banned:<3").notes).toHaveLength(1);
  });

  it("keeps ~ in rules text for the SQL to read as the card's name", () => {
    expect(only('o:"when ~ dies"').node).toEqual(term("oracle", ":", "when ~ dies"));
  });

  it("accepts every new is: value", () => {
    for (const value of [
      "frenchvanilla",
      "modal",
      "party",
      "outlaw",
      "hybrid",
      "phyrexian",
      "basic",
      "fetchable",
      "dual",
      "shockland",
      "fetchland",
      "checkland",
      "fastland",
      "slowland",
      "painland",
      "bounceland",
      "scryland",
      "gainland",
      "triome",
      "cycleland",
      "manland",
      "pathway",
    ]) {
      expect(only(`is:${value}`).notes).toEqual([]);
    }
  });
});
