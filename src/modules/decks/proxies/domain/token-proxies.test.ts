import { describe, expect, it } from "vitest";
import { printedCard, printedFace } from "../testing/printed-cards";
import {
  cardsToPrint,
  DEFAULT_PROXY_OPTIONS,
  type ProxyLine,
  type ProxyOptions,
} from "./proxy-sheet";
import {
  deckTokens,
  filterTokenChecklist,
  newestFirst,
  sheetCards,
  summarizeTokenChecklist,
  tokenDescription,
  tokenKind,
  tokenRulesText,
  tokensToPrint,
  toTokenChecklistItem,
  type TokenArt,
  type TokenLinkRow,
  type TokenMaker,
} from "./token-proxies";

// Which tokens a deck makes, their default art, and the copies printed (design doc 25).

function art(id: string, changes: Partial<TokenArt> = {}): TokenArt {
  return {
    id,
    oracleId: "goblin",
    name: "Goblin",
    setCode: "tm13",
    setName: "Magic 2013 Tokens",
    collectorNumber: "1",
    colors: ["R"],
    faces: [
      printedFace({
        name: "Goblin",
        manaCost: null,
        typeLine: "Token Creature — Goblin",
        power: "1",
        toughness: "1",
      }),
    ],
    artist: "Someone",
    releasedAt: "2012-07-13",
    hasBack: false,
    ...changes,
  };
}

const m13Goblin = art("goblin-m13");
const newGoblin = art("goblin-new", { setCode: "tfdn", releasedAt: "2024-11-15" });
const treasure = art("treasure", {
  oracleId: "treasure",
  name: "Treasure",
  colors: [],
  faces: [
    printedFace({
      name: "Treasure",
      manaCost: null,
      typeLine: "Token Artifact — Treasure",
      text: "{T}, Sacrifice this token: Add one mana of any color.",
      power: null,
      toughness: null,
    }),
  ],
});

const krenko: TokenMaker = {
  oracleId: "krenko",
  printingId: "krenko-m13",
  name: "Krenko, Mob Boss",
  board: "main",
};
const instigator: TokenMaker = {
  oracleId: "instigator",
  printingId: "instigator-fdn",
  name: "Goblin Instigator",
  board: "main",
};
const tithe: TokenMaker = {
  oracleId: "tithe",
  printingId: "tithe-1",
  name: "Smothering Tithe",
  board: "side",
};

const links: TokenLinkRow[] = [
  { cardOracleId: "krenko", printingId: "krenko-m13", token: m13Goblin },
  { cardOracleId: "krenko", printingId: "krenko-reprint", token: newGoblin },
  { cardOracleId: "instigator", printingId: "instigator-other", token: newGoblin },
  { cardOracleId: "tithe", printingId: "tithe-1", token: treasure },
];

describe("deckTokens", () => {
  it("lists each token once, by name, with every card that makes it", () => {
    const tokens = deckTokens([krenko, instigator, tithe], links, [], new Map());
    expect(tokens.map((token) => [token.name, token.madeBy])).toEqual([
      ["Goblin", ["Krenko, Mob Boss", "Goblin Instigator"]],
      ["Treasure", ["Smothering Tithe"]],
    ]);
    expect(tokens[1].boards).toEqual(["side"]);
  });

  it("defaults to the token your card's own printing makes", () => {
    const [goblin] = deckTokens([krenko], links, [], new Map());
    expect(goblin.art.id).toBe("goblin-m13");
    expect(goblin.defaultArtId).toBe("goblin-m13");
    expect(goblin.artChosen).toBe(false);
  });

  it("prefers a later card's own printing over an earlier card's guess", () => {
    // Goblin Instigator's printing in the deck links to nothing, so it guesses the newest; then
    // Krenko's own printing links to the M13 Goblin.
    const [goblin] = deckTokens([instigator, krenko], links, [], new Map());
    expect(goblin.art.id).toBe("goblin-m13");
  });

  it("falls back to the newest printing any of the card's printings make", () => {
    const [goblin] = deckTokens([{ ...krenko, printingId: "krenko-promo" }], links, [], new Map());
    expect(goblin.art.id).toBe("goblin-new");
  });

  it("uses your chosen art, and whether you left the token out", () => {
    const chosen = art("goblin-chosen", { setCode: "tdom" });
    const [goblin] = deckTokens(
      [krenko],
      links,
      [{ tokenOracleId: "goblin", tokenId: "goblin-chosen", included: false }],
      new Map([["goblin-chosen", chosen]]),
    );
    expect(goblin).toMatchObject({
      art: { id: "goblin-chosen" },
      defaultArtId: "goblin-m13",
      artChosen: true,
      included: false,
    });
  });

  it("ignores a chosen art of another token, and choices for tokens the deck doesn't make", () => {
    const tokens = deckTokens(
      [krenko],
      links,
      [
        { tokenOracleId: "goblin", tokenId: "treasure", included: true },
        { tokenOracleId: "treasure", tokenId: null, included: false },
      ],
      new Map([["treasure", treasure]]),
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ art: { id: "goblin-m13" }, artChosen: false });
  });

  it("makes no tokens for cards that make none", () => {
    expect(deckTokens([{ ...krenko, oracleId: "bolt" }], links, [], new Map())).toEqual([]);
  });

  it("makes no tokens for maybeboard cards (design doc 32)", () => {
    expect(deckTokens([{ ...tithe, board: "maybe" }], links, [], new Map())).toEqual([]);
  });
});

describe("tokensToPrint", () => {
  const tokens = deckTokens([krenko, tithe], links, [], new Map());
  const names = (options: Partial<ProxyOptions>) =>
    tokensToPrint(tokens, { ...DEFAULT_PROXY_OPTIONS, ...options }).map((card) => card.name);

  it("prints two of each by default, after nothing else, by name", () => {
    expect(names({})).toEqual(["Goblin", "Goblin", "Treasure", "Treasure"]);
  });

  it("prints 0 to 4 copies", () => {
    expect(names({ tokenCopies: 0 })).toEqual([]);
    expect(names({ tokenCopies: 1 })).toEqual(["Goblin", "Treasure"]);
    expect(names({ tokenCopies: 4 })).toHaveLength(8);
  });

  it("leaves out tokens only sideboard cards make when the sideboard is left out", () => {
    expect(names({ cards: "noSideboard", tokenCopies: 1 })).toEqual(["Goblin"]);
  });

  it("still prints tokens of cards you own for real", () => {
    expect(names({ realCards: "leaveOut", tokenCopies: 1 })).toEqual(["Goblin", "Treasure"]);
  });

  it("leaves out tokens you unticked", () => {
    const [goblin, rest] = tokens;
    const printed = tokensToPrint([{ ...goblin, included: false }, rest], {
      ...DEFAULT_PROXY_OPTIONS,
      tokenCopies: 1,
    });
    expect(printed.map((card) => card.name)).toEqual(["Treasure"]);
  });

  it("prints a token as a non-foil playtest token, with its back only when backs print", () => {
    const incubator = art("incubator", {
      oracleId: "incubator",
      name: "Incubator // Phyrexian",
      hasBack: true,
    });
    const line = { ...tokens[0], art: incubator };
    const [withBack] = tokensToPrint([line], DEFAULT_PROXY_OPTIONS);
    expect(withBack).toMatchObject({
      printingId: "incubator",
      hasBack: true,
      isFoil: false,
      printed: { isToken: true, doubleFaced: true, colors: ["R"], producedMana: [] },
    });
    const [frontOnly] = tokensToPrint([line], { ...DEFAULT_PROXY_OPTIONS, backFaces: "skip" });
    expect(frontOnly.hasBack).toBe(false);
  });
});

describe("newestFirst and tokenDescription", () => {
  it("sorts newest first, then by set and number", () => {
    const older = art("a", { releasedAt: "2020-01-01", setCode: "tb" });
    const sameDay = art("b", { releasedAt: "2020-01-01", setCode: "ta", collectorNumber: "10" });
    const sameDayLower = art("c", {
      releasedAt: "2020-01-01",
      setCode: "ta",
      collectorNumber: "9",
    });
    expect(newestFirst([older, sameDay, newGoblin, sameDayLower]).map((each) => each.id)).toEqual([
      "goblin-new",
      "c",
      "b",
      "a",
    ]);
  });

  it("describes a token by its type line and stats", () => {
    expect(tokenDescription(m13Goblin)).toBe("Token Creature — Goblin · 1/1");
    expect(tokenDescription(treasure)).toBe("Token Artifact — Treasure");
  });
});

describe("sheetCards", () => {
  const bolt: ProxyLine = {
    oracleId: "bolt",
    ownedReal: 0,
    printingId: "bolt-m11",
    name: "Lightning Bolt",
    quantity: 2,
    board: "main",
    isBasicLand: false,
    hasBack: false,
    isFoil: false,
    printed: printedCard(),
  };
  const tokens = deckTokens([krenko], links, [], new Map());

  it("prints the cards, then the tokens", () => {
    const names = sheetCards([bolt], tokens, DEFAULT_PROXY_OPTIONS).map((card) => card.name);
    expect(names).toEqual(["Lightning Bolt", "Lightning Bolt", "Goblin", "Goblin"]);
  });

  it("prints exactly today's cards with no token copies (invariant 1)", () => {
    const options = { ...DEFAULT_PROXY_OPTIONS, tokenCopies: 0 as const };
    expect(sheetCards([bolt], tokens, options)).toEqual(cardsToPrint([bolt], options));
  });
});

describe("token checklist (design doc 42)", () => {
  const emblem = art("elspeth-emblem", {
    oracleId: "elspeth-emblem",
    name: "Elspeth, Knight-Errant Emblem",
    colors: [],
    faces: [
      printedFace({
        name: "Elspeth, Knight-Errant Emblem",
        typeLine: "Emblem — Elspeth",
        text: "Artifacts, creatures, enchantments, and lands you control have indestructible.",
        power: null,
        toughness: null,
      }),
    ],
  });
  const monarch = art("monarch-helper", {
    oracleId: "monarch-helper",
    name: "The Monarch",
    colors: [],
    faces: [
      printedFace({
        name: "The Monarch",
        typeLine: "Card",
        text: "At the beginning of your end step, draw a card.",
        power: null,
        toughness: null,
      }),
    ],
  });
  const incubator = art("incubator-dfc", {
    oracleId: "incubator-dfc",
    name: "Incubator // Phyrexian",
    hasBack: true,
    faces: [
      printedFace({
        name: "Incubator",
        typeLine: "Token Artifact — Incubator",
        text: "{2}: Transform this artifact.",
        power: null,
        toughness: null,
      }),
      printedFace({
        name: "Phyrexian",
        typeLine: "Token Artifact Creature — Phyrexian",
        text: "",
        power: "0",
        toughness: "0",
      }),
    ],
  });

  const checklistLines = deckTokens(
    [
      krenko,
      tithe,
      {
        oracleId: "elspeth",
        printingId: "elspeth-1",
        name: "Elspeth, Knight-Errant",
        board: "commander",
      },
      { oracleId: "palace", printingId: "palace-1", name: "Palace Jailer", board: "main" },
    ],
    [
      ...links,
      { cardOracleId: "elspeth", printingId: "elspeth-1", token: emblem },
      { cardOracleId: "palace", printingId: "palace-1", token: monarch },
    ],
    [],
    new Map(),
  );

  it("classifies tokens, emblems, double-faced tokens, and helpers", () => {
    expect(tokenKind(m13Goblin)).toBe("token");
    expect(tokenKind(incubator)).toBe("token");
    expect(tokenKind(emblem)).toBe("emblem");
    expect(tokenKind(monarch)).toBe("helper");
    expect(tokenRulesText(incubator)).toBe("{2}: Transform this artifact.");
  });

  it("summarizes counts cleanly with consistent mainboard and sideboard totals", () => {
    const summary = summarizeTokenChecklist(checklistLines);
    expect(summary).toEqual({
      total: 4,
      tokens: 2,
      emblems: 1,
      helpers: 1,
      mainboard: 3,
      sideboardOnly: 1,
    });
    expect(summary.tokens + summary.emblems + summary.helpers).toBe(summary.total);
    expect(summary.mainboard + summary.sideboardOnly).toBe(summary.total);
  });

  it("builds checklist items and filters by kind and played boards", () => {
    const items = checklistLines.map(toTokenChecklistItem);
    const treasureItem = items.find((item) => item.name === "Treasure");
    const emblemItem = items.find((item) => item.kind === "emblem");

    expect(treasureItem?.sideboardOnly).toBe(true);
    expect(emblemItem).toMatchObject({
      kind: "emblem",
      sideboardOnly: false,
      description: "Emblem — Elspeth",
      text: "Artifacts, creatures, enchantments, and lands you control have indestructible.",
    });

    expect(filterTokenChecklist(items, { kind: "emblem" }).map((item) => item.name)).toEqual([
      "Elspeth, Knight-Errant Emblem",
    ]);
    expect(filterTokenChecklist(items, { board: "played" }).map((item) => item.name)).toEqual([
      "Elspeth, Knight-Errant Emblem",
      "Goblin",
      "The Monarch",
    ]);
  });
});
