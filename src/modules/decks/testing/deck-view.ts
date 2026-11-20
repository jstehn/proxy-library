import { extractFeatures } from "@/modules/catalog";
import { type Tag, UserId } from "@/shared/kernel";
import { DeckId } from "../domain/deck";
import type { DeckLine, DeckView } from "../domain/deck-view";
import type { CardRules } from "../domain/rules";

// A deck as the readers return it, for tests of what is built on top of `deckView`.

/** A deck line; its role tags come from its text and mana unless the test names them. */
export function aLine(name: string, overrides: Partial<DeckLine> = {}): DeckLine {
  const line: DeckLine = {
    oracleId: `oracle-${name}`,
    board: "main",
    quantity: 1,
    printingId: `printing-${name}`,
    finish: "nonfoil",
    pinnedPrintingId: null,
    pinnedFinish: null,
    heading: null,
    note: null,
    name,
    typeLine: "Creature — Elf",
    manaValue: 2,
    manaCost: "{1}{G}",
    producedMana: [],
    roles: [],
    themes: [],
    leaderThemes: [],
    text: "",
    isGameChanger: false,
    priceCents: 25,
    setCode: "tst",
    collectorNumber: "1",
    rarity: "common",
    keywords: [],
    edhrecRank: null,
    owned: 1,
    ownedReal: 0,
    isBasicLand: false,
    otherDecks: [],
    free: 1,
    ...overrides,
  };
  const text = featuresOfText(line);
  return {
    ...line,
    roles: overrides.roles ?? text.roles,
    themes: overrides.themes ?? text.themes,
    leaderThemes: overrides.leaderThemes ?? text.leaderThemes,
  };
}

/**
 * What the catalog's recognizers say a card's text does, named as a line carries it (tests build
 * lines from text). Spread it under what a test names itself.
 */
export function featuresOfText(card: {
  typeLine: string;
  text?: string;
  producedMana?: readonly string[];
}) {
  const features = extractFeatures({
    oracleId: "test",
    producedMana: card.producedMana ?? [],
    faces: [{ typeLine: card.typeLine, text: card.text ?? "" }],
  });
  return {
    roles: features.roleTags,
    themes: features.themes,
    leaderThemes: features.leaderThemes,
  };
}

export const roleTagsOf = (card: Parameters<typeof featuresOfText>[0]): Tag[] => [
  ...featuresOfText(card).roles,
];

export function aRules(name: string, overrides: Partial<CardRules> = {}): CardRules {
  return {
    name,
    typeLine: "Creature — Elf",
    text: "",
    colorIdentity: [],
    legalities: { commander: "legal", casual: "legal" },
    isBasicLand: false,
    hasPowerToughness: true,
    ...overrides,
  };
}

export function aDeckView(
  lines: readonly DeckLine[],
  overrides: Partial<DeckView["deck"]> = {},
): DeckView {
  return {
    deck: {
      id: DeckId.of(1),
      ownerId: UserId.of("1"),
      name: "Elves",
      format: "casual",
      usesRealCards: false,
      targetBracket: null,
      grouping: "type",
      headings: [],
      entries: lines.map((line) => ({
        oracleId: line.oracleId,
        board: line.board,
        quantity: line.quantity,
        printingId: null,
        finish: null,
        heading: null,
        note: null,
      })),
      ...overrides,
    },
    lines: [...lines],
    rules: Object.fromEntries(lines.map((line) => [line.oracleId, aRules(line.name)])),
  };
}
