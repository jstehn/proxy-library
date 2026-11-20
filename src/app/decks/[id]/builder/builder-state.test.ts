import { describe, expect, it } from "vitest";
import type { PrintingCard } from "@/modules/catalog";
import type { BrowseCard, CardRules, DeckLine, OtherDeckUse } from "@/modules/decks";
import {
  builderReducer,
  copiesOnBoards,
  initialBuilderState,
  type BuilderAction,
  type BuilderState,
} from "./builder-state";
import type { BuilderDeck } from "./builder-deck";
import { provisionalLine } from "./derive";
import type { Selection } from "./selection/selection";

const rules = (name: string): CardRules => ({
  name,
  typeLine: "Creature — Elf",
  text: "",
  colorIdentity: [],
  legalities: { commander: "legal" },
  isBasicLand: false,
  hasPowerToughness: true,
});

const gridCard = (name: string): BrowseCard => ({
  oracleId: name,
  printingId: `printing-${name}`,
  ownedReal: 0,
  isGameChanger: false,
  name,
  manaCost: "{1}{G}",
  manaValue: 2,
  typeLine: "Creature — Elf",
  owned: 2,
  inThisDeck: 0,
  otherDecks: 1,
  free: 1,
  misfit: null,
  rules: rules(name),
  producedMana: [],
  roles: [],
  themes: [],
  text: "",
  setCode: "tst",
  collectorNumber: "1",
  finish: "nonfoil",
  priceCents: 25,
});

const elf = gridCard("Elf");
const bear = gridCard("Bear");

const deckOf = (lines: DeckLine[]): BuilderDeck => ({
  lines,
  rules: { Elf: elf.rules },
  cards: {},
  grouping: "type",
  headings: ["Ramp", "Draw"],
});

const selectionOf = (card: BrowseCard): Selection => ({
  oracleId: card.oracleId,
  printingId: card.printingId,
  name: card.name,
  owned: card.owned,
  ownedReal: 0,
  inDeck: {},
  otherDecks: 1,
  free: 1,
  misfit: null,
  priceCents: 25,
  tags: [],
  bracketFlags: [],
});

const start = (lines: DeckLine[] = []) => initialBuilderState(deckOf(lines), null);
const run = (state: BuilderState, ...actions: BuilderAction[]) =>
  actions.reduce(builderReducer, state);

describe("the builder's shared state", () => {
  it("starts with every panel closed and nothing selected", () => {
    const state = start();
    expect(Object.values(state.openPanels).some(Boolean)).toBe(false);
    expect(state.selected).toBeNull();
    expect(state.message).toBeNull();
  });

  describe("guessing a quantity before the server answers", () => {
    it("makes a provisional line for a card new to the deck", () => {
      const state = run(start(), {
        type: "quantityGuessed",
        change: { oracleId: "Elf", board: "main", quantity: 2 },
        gridCard: elf,
      });
      expect(state.deck.lines).toEqual([provisionalLine(elf, "main", 2)]);
      expect(state.deck.rules.Elf).toEqual(elf.rules);
    });

    it("changes an existing line, and drops it at zero", () => {
      const lines = [provisionalLine(elf, "main", 2)];
      const more = run(start(lines), {
        type: "quantityGuessed",
        change: { oracleId: "Elf", board: "main", quantity: 3 },
        gridCard: null,
      });
      expect(more.deck.lines[0].quantity).toBe(3);
      const none = run(more, {
        type: "quantityGuessed",
        change: { oracleId: "Elf", board: "main", quantity: 0 },
        gridCard: null,
      });
      expect(none.deck.lines).toEqual([]);
    });

    it("ignores a grid card that isn't the card changed", () => {
      const state = run(start(), {
        type: "quantityGuessed",
        change: { oracleId: "Elf", board: "main", quantity: 1 },
        gridCard: bear,
      });
      expect(state.deck.lines).toEqual([]);
    });
  });

  describe("moving a line", () => {
    it("merges into the line already on the other board, at most 99", () => {
      const main = provisionalLine(elf, "main", 60);
      const maybe = provisionalLine(elf, "maybe", 50);
      const state = run(start([main, maybe]), { type: "lineMoved", line: maybe, to: "main" });
      expect(state.deck.lines).toHaveLength(1);
      expect(state.deck.lines[0]).toMatchObject({ board: "main", quantity: 99 });
    });

    it("moves a line to an empty board", () => {
      const main = provisionalLine(elf, "main", 1);
      const state = run(start([main]), { type: "lineMoved", line: main, to: "maybe" });
      expect(state.deck.lines.map((line) => line.board)).toEqual(["maybe"]);
    });
  });

  it("edits only the line it was given", () => {
    const first = provisionalLine(elf, "main", 1);
    const second = provisionalLine(bear, "main", 1);
    const state = run(start([first, second]), {
      type: "lineEdited",
      line: second,
      patch: { note: "combo piece", role: "ramp" },
    });
    expect(state.deck.lines[0]).toBe(first);
    expect(state.deck.lines[1]).toMatchObject({ note: "combo piece", role: "ramp" });
  });

  it("orders headings and switches the grouping", () => {
    const state = run(
      start(),
      { type: "headingsOrdered", order: ["Draw", "Ramp"] },
      { type: "groupingChosen", grouping: "custom" },
    );
    expect(state.deck.headings).toEqual(["Draw", "Ramp"]);
    expect(state.deck.grouping).toBe("custom");
  });

  it("replaces the deck with the server's", () => {
    const fresh = deckOf([provisionalLine(bear, "main", 4)]);
    expect(run(start(), { type: "deckReplaced", deck: fresh }).deck).toBe(fresh);
  });

  it("toggles and closes panels independently", () => {
    const opened = run(
      start(),
      { type: "panelToggled", panel: "cuts" },
      { type: "panelToggled", panel: "testHand" },
    );
    expect(opened.openPanels).toMatchObject({ cuts: true, testHand: true, suggestions: false });
    const closed = run(opened, { type: "panelToggled", panel: "cuts" });
    expect(closed.openPanels.cuts).toBe(false);
    expect(run(opened, { type: "panelClosed", panel: "testHand" }).openPanels.testHand).toBe(false);
  });

  it("highlights a role or a bracket rule, never both", () => {
    const role = run(start(), { type: "roleHighlighted", tag: "ramp" });
    expect(role).toMatchObject({ highlightedRole: "ramp", highlightedRule: null });
    const rule = run(role, { type: "ruleHighlighted", rule: "gameChangers" });
    expect(rule).toMatchObject({ highlightedRole: null, highlightedRule: "gameChangers" });
    expect(run(rule, { type: "roleHighlighted", tag: null }).highlightedRule).toBeNull();
  });

  describe("the selected card", () => {
    const select = (state: BuilderState, card: BrowseCard) =>
      builderReducer(state, {
        type: "cardSelected",
        selection: selectionOf(card),
        gridCard: card,
        otherDecks: "loading",
      });

    it("starts at one copy, with its other decks loading", () => {
      const state = select(start(), elf);
      expect(state.selected).toMatchObject({ quantity: 1, otherDecks: "loading", detail: null });
    });

    it("takes the detail from the deck's cards when they're known", () => {
      const detail = { name: "Elf" } as PrintingCard;
      const deck: BuilderDeck = { ...deckOf([]), cards: { "printing-Elf": detail } };
      const state = select(initialBuilderState(deck, null), elf);
      expect(state.selected?.detail).toBe(detail);
    });

    it("ignores a detail for a card that is no longer selected", () => {
      const state = run(select(start(), elf), {
        type: "detailArrived",
        printingId: "printing-Bear",
        detail: { name: "Bear" } as PrintingCard,
      });
      expect(state.selected?.detail).toBeNull();
    });

    it("keeps a detail for the selected card", () => {
      const detail = { name: "Elf" } as PrintingCard;
      const state = run(select(start(), elf), {
        type: "detailArrived",
        printingId: "printing-Elf",
        detail,
      });
      expect(state.selected?.detail).toBe(detail);
    });

    it("ignores other decks that arrive for another card", () => {
      const uses: OtherDeckUse[] = [{ deckId: 2, name: "Other", quantity: 1 } as OtherDeckUse];
      const state = run(select(start(), elf), {
        type: "otherDecksArrived",
        oracleId: "Bear",
        uses,
      });
      expect(state.selected?.otherDecks).toBe("loading");
      const right = run(state, { type: "otherDecksArrived", oracleId: "Elf", uses });
      expect(right.selected?.otherDecks).toBe(uses);
    });

    it("steps the quantity between 1 and 99", () => {
      const state = select(start(), elf);
      const down = run(state, { type: "quantityStepped", by: -1 });
      expect(down.selected?.quantity).toBe(1);
      const up = run(
        state,
        { type: "quantityChosen", quantity: 99 },
        { type: "quantityStepped", by: 1 },
      );
      expect(up.selected?.quantity).toBe(99);
    });

    it("notes copies added to a board", () => {
      const state = run(select(start(), elf), { type: "addedToBoard", board: "side", quantity: 2 });
      expect(state.selected?.selection.inDeck).toEqual({ side: 2 });
    });

    it("counts copies taken from another deck, up to what you own", () => {
      const taken = run(select(start(), elf), {
        type: "copiesTaken",
        oracleId: "Elf",
        count: 5,
        emptied: true,
      });
      expect(taken.selected?.selection).toMatchObject({ free: 2, otherDecks: 0 });
      const other = run(select(start(), elf), {
        type: "copiesTaken",
        oracleId: "Bear",
        count: 1,
        emptied: true,
      });
      expect(other.selected?.selection).toMatchObject({ free: 1, otherDecks: 1 });
    });

    it("clears the selection", () => {
      expect(run(select(start(), elf), { type: "selectionCleared" }).selected).toBeNull();
    });

    it("keeps look-alikes only for the card they were asked for", () => {
      const asked = run(start(), { type: "similarRequested", oracleId: "Elf" });
      expect(asked.similar).toEqual({ oracleId: "Elf", list: "loading" });
      const stale = run(asked, { type: "similarArrived", oracleId: "Bear", list: null });
      expect(stale.similar?.list).toBe("loading");
      const answered = run(asked, { type: "similarArrived", oracleId: "Elf", list: null });
      expect(answered.similar).toEqual({ oracleId: "Elf", list: null });
    });
  });

  it("reads a card's copies per board from the deck in hand", () => {
    const deck = deckOf([provisionalLine(elf, "main", 3), provisionalLine(elf, "side", 1)]);
    expect(copiesOnBoards(deck, "Elf")).toEqual({ main: 3, side: 1 });
    expect(copiesOnBoards(deck, "Bear")).toEqual({});
  });

  it("shows and replaces the message", () => {
    const state = run(
      start(),
      { type: "messageShown", message: { tone: "ok", text: "Saved." } },
      { type: "messageShown", message: { tone: "error", text: "Nope." } },
    );
    expect(state.message).toEqual({ tone: "error", text: "Nope." });
  });

  it("sets the target bracket", () => {
    expect(run(start(), { type: "targetBracketSet", target: 3 }).targetBracket).toBe(3);
  });
});
