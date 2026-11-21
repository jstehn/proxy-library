import { extractFeatures } from "@/modules/catalog";
import { UserId } from "@/shared/kernel";
import { type Tag } from "@/shared/mtg";
import { DeckId } from "../domain/deck";
import { bracketFlagsOf } from "../domain/brackets";
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
    bracketFlags: [],
    signals: { makes: [], uses: [] },
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
    bracketFlags: overrides.bracketFlags ?? text.bracketFlags,
    signals: overrides.signals ?? text.signals,
  };
}

/**
 * What the catalog's recognizers say a card's text does, named as a line carries it (tests build
 * lines from text). Spread it under what a test names itself.
 */
type CardInput = {
  typeLine: string;
  text?: string;
  producedMana?: readonly string[];
  isGameChanger?: boolean;
  manaValue?: number;
  name?: string;
  keywords?: readonly string[];
};

/** Every feature of a single-faced card, worked out by the catalog's recognizers. */
export function cardFeaturesOf(card: CardInput) {
  return extractFeatures({
    oracleId: card.name ?? "test",
    producedMana: card.producedMana ?? [],
    keywords: card.keywords ?? [],
    manaValue: card.manaValue ?? 0,
    faces: [{ name: card.name ?? "Test", typeLine: card.typeLine, text: card.text ?? "" }],
  });
}

export function featuresOfText(card: CardInput) {
  const features = cardFeaturesOf(card);
  return {
    roles: features.roleTags,
    themes: features.themes,
    leaderThemes: features.leaderThemes,
    bracketFlags: bracketFlagsOf(card.isGameChanger ?? false, features.bracketFlags),
    signals: features.signalIO,
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
