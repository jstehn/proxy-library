import { UserId } from "@/shared/kernel";
import { DeckId } from "../domain/deck";
import type { DeckLine, DeckView } from "../domain/deck-view";
import type { CardRules } from "../domain/rules";

// A deck as the readers return it, for tests of what is built on top of `deckView`.

export function aLine(name: string, overrides: Partial<DeckLine> = {}): DeckLine {
  return {
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
}

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
