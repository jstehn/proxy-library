import { type Tag } from "@/shared/mtg";
import type { PrintingCard } from "@/modules/catalog";
import type {
  Board,
  Bracket,
  BracketRule,
  BrowseCard,
  DeckLine,
  OtherDeckUse,
  SuggestionList,
} from "@/modules/decks";
import type { BuilderDeck } from "./builder-deck";
import { provisionalLine } from "./derive";
import type { Selection } from "./selection/selection";

// The state several panels of the deck builder share, as one reducer (design doc 14): the deck
// in hand, the message under the tabs, which panels are open, what's highlighted, and the
// selected card. Pure, so it is unit-tested; the components only dispatch named actions.
// State that belongs to one panel (the search box, a panel's loaded list) stays in that panel.

export type BuilderMessage = Readonly<{ tone: "ok" | "error"; text: string }>;

export const PANEL_NAMES = [
  "suggestions",
  "cuts",
  "manaBase",
  "draft",
  "testHand",
  "snapshots",
  "tokens",
  "primer",
] as const;
export type PanelName = (typeof PANEL_NAMES)[number];

/** Cards like the selected one, once asked for (null list: nothing found; "loading": on its way). */
export type SimilarCards = Readonly<{
  oracleId: string;
  list: SuggestionList | "loading" | null;
}>;

/** The selected card, and what's known about it beyond the deck. */
export type SelectedState = Readonly<{
  selection: Selection;
  /** The grid card behind the selection, to show a new card before the server answers. */
  gridCard: BrowseCard | null;
  detail: PrintingCard | null;
  /** The card's other decks: "loading" while they're fetched. */
  otherDecks: readonly OtherDeckUse[] | "loading";
  /** How many the "Add" buttons add. */
  quantity: number;
}>;

export type BuilderState = Readonly<{
  deck: BuilderDeck;
  message: BuilderMessage | null;
  targetBracket: Bracket | null;
  openPanels: Readonly<Record<PanelName, boolean>>;
  /** The deck list marks one thing at a time: a role's cards or a bracket reason's. */
  highlightedRole: Tag | null;
  highlightedRule: BracketRule | null;
  selected: SelectedState | null;
  similar: SimilarCards | null;
}>;

export type BuilderAction =
  | Readonly<{ type: "messageShown"; message: BuilderMessage }>
  | Readonly<{ type: "deckReplaced"; deck: BuilderDeck }>
  /** A quantity changed before the server answers; `gridCard` makes a line for a new card. */
  | Readonly<{
      type: "quantityGuessed";
      change: Readonly<{ oracleId: string; board: Board; quantity: number }>;
      gridCard: BrowseCard | null;
    }>
  | Readonly<{ type: "lineMoved"; line: DeckLine; to: Board }>
  | Readonly<{ type: "lineEdited"; line: DeckLine; patch: Partial<DeckLine> }>
  | Readonly<{ type: "headingsOrdered"; order: readonly string[] }>
  | Readonly<{ type: "groupingChosen"; grouping: BuilderDeck["grouping"] }>
  | Readonly<{ type: "targetBracketSet"; target: Bracket | null }>
  | Readonly<{ type: "panelToggled"; panel: PanelName }>
  | Readonly<{ type: "panelClosed"; panel: PanelName }>
  | Readonly<{ type: "roleHighlighted"; tag: Tag | null }>
  | Readonly<{ type: "ruleHighlighted"; rule: BracketRule | null }>
  | Readonly<{
      type: "cardSelected";
      selection: Selection;
      gridCard: BrowseCard | null;
      /** Known already (a deck line has them), or "loading" while they're fetched. */
      otherDecks: readonly OtherDeckUse[] | "loading";
    }>
  | Readonly<{ type: "selectionCleared" }>
  | Readonly<{ type: "detailArrived"; printingId: string; detail: PrintingCard | null }>
  | Readonly<{ type: "otherDecksRequested" }>
  | Readonly<{
      type: "otherDecksArrived";
      oracleId: string;
      uses: readonly OtherDeckUse[];
    }>
  | Readonly<{ type: "quantityChosen"; quantity: number }>
  | Readonly<{ type: "quantityStepped"; by: number }>
  | Readonly<{ type: "addedToBoard"; board: Board; quantity: number }>
  | Readonly<{
      type: "copiesTaken";
      oracleId: string;
      count: number;
      /** The other deck has none left of this card. */
      emptied: boolean;
    }>
  | Readonly<{ type: "similarRequested"; oracleId: string }>
  | Readonly<{ type: "similarArrived"; oracleId: string; list: SuggestionList | null }>;

const MOST_ON_A_LINE = 99;

export function initialBuilderState(
  deck: BuilderDeck,
  targetBracket: Bracket | null,
): BuilderState {
  return {
    deck,
    message: null,
    targetBracket,
    openPanels: Object.fromEntries(PANEL_NAMES.map((name) => [name, false])) as Record<
      PanelName,
      boolean
    >,
    highlightedRole: null,
    highlightedRule: null,
    selected: null,
    similar: null,
  };
}

/** Copies of a card in the deck, per board, from the deck in hand. */
export function copiesOnBoards(
  deck: BuilderDeck,
  oracleId: string,
): Partial<Record<Board, number>> {
  const counts: Partial<Record<Board, number>> = {};
  for (const line of deck.lines) {
    if (line.oracleId === oracleId) counts[line.board] = line.quantity;
  }
  return counts;
}

function withDeck(state: BuilderState, change: (deck: BuilderDeck) => BuilderDeck): BuilderState {
  return { ...state, deck: change(state.deck) };
}

function withSelected(
  state: BuilderState,
  change: (selected: SelectedState) => SelectedState,
): BuilderState {
  return state.selected === null ? state : { ...state, selected: change(state.selected) };
}

/** The deck with one line's quantity changed; a card new to it gets a line made from its grid card. */
function quantityGuessed(
  deck: BuilderDeck,
  change: Readonly<{ oracleId: string; board: Board; quantity: number }>,
  gridCard: BrowseCard | null,
): BuilderDeck {
  const card = gridCard?.oracleId === change.oracleId ? gridCard : null;
  const exists = deck.lines.some(
    (line) => line.oracleId === change.oracleId && line.board === change.board,
  );
  if (!exists && card !== null && change.quantity > 0) {
    return {
      ...deck,
      lines: [...deck.lines, provisionalLine(card, change.board, change.quantity)],
      rules: { [card.oracleId]: card.rules, ...deck.rules },
    };
  }
  return {
    ...deck,
    lines: deck.lines
      .map((line) =>
        line.oracleId === change.oracleId && line.board === change.board
          ? { ...line, quantity: change.quantity }
          : line,
      )
      .filter((line) => line.quantity > 0),
  };
}

/** The deck with a line moved to another board, merging into the line already there. */
function lineMoved(deck: BuilderDeck, line: DeckLine, to: Board): BuilderDeck {
  const there = deck.lines.find((other) => other.oracleId === line.oracleId && other.board === to);
  const rest = deck.lines.filter(
    (other) =>
      other.oracleId !== line.oracleId || (other.board !== line.board && other.board !== to),
  );
  const quantity = Math.min(MOST_ON_A_LINE, line.quantity + (there?.quantity ?? 0));
  return { ...deck, lines: [...rest, { ...line, board: to, quantity }] };
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case "messageShown":
      return { ...state, message: action.message };
    case "deckReplaced":
      return { ...state, deck: action.deck };
    case "quantityGuessed":
      return withDeck(state, (deck) => quantityGuessed(deck, action.change, action.gridCard));
    case "lineMoved":
      return withDeck(state, (deck) => lineMoved(deck, action.line, action.to));
    case "lineEdited":
      return withDeck(state, (deck) => ({
        ...deck,
        lines: deck.lines.map((each) =>
          each === action.line ? { ...each, ...action.patch } : each,
        ),
      }));
    case "headingsOrdered":
      return withDeck(state, (deck) => ({ ...deck, headings: [...action.order] }));
    case "groupingChosen":
      return withDeck(state, (deck) => ({ ...deck, grouping: action.grouping }));
    case "targetBracketSet":
      return { ...state, targetBracket: action.target };
    case "panelToggled":
      return {
        ...state,
        openPanels: { ...state.openPanels, [action.panel]: !state.openPanels[action.panel] },
      };
    case "panelClosed":
      return { ...state, openPanels: { ...state.openPanels, [action.panel]: false } };
    case "roleHighlighted":
      return { ...state, highlightedRole: action.tag, highlightedRule: null };
    case "ruleHighlighted":
      return { ...state, highlightedRule: action.rule, highlightedRole: null };
    case "cardSelected": {
      const detail = state.deck.cards[action.selection.printingId] ?? null;
      return {
        ...state,
        selected: {
          selection: action.selection,
          gridCard: action.gridCard,
          detail,
          otherDecks: action.otherDecks,
          quantity: 1,
        },
      };
    }
    case "selectionCleared":
      return { ...state, selected: null };
    case "detailArrived":
      // Only if the same printing is still selected when the answer arrives.
      return withSelected(state, (selected) =>
        selected.selection.printingId === action.printingId
          ? { ...selected, detail: action.detail }
          : selected,
      );
    case "otherDecksRequested":
      return withSelected(state, (selected) => ({ ...selected, otherDecks: "loading" }));
    case "otherDecksArrived":
      return withSelected(state, (selected) =>
        selected.selection.oracleId === action.oracleId
          ? { ...selected, otherDecks: action.uses }
          : selected,
      );
    case "quantityChosen":
      return withSelected(state, (selected) => ({ ...selected, quantity: action.quantity }));
    case "quantityStepped":
      return withSelected(state, (selected) => ({
        ...selected,
        quantity: Math.max(1, Math.min(MOST_ON_A_LINE, selected.quantity + action.by)),
      }));
    case "addedToBoard":
      return withSelected(state, (selected) => ({
        ...selected,
        selection: {
          ...selected.selection,
          inDeck: { ...selected.selection.inDeck, [action.board]: action.quantity },
        },
      }));
    case "copiesTaken":
      return withSelected(state, (selected) =>
        selected.selection.oracleId === action.oracleId
          ? {
              ...selected,
              selection: {
                ...selected.selection,
                free: Math.min(selected.selection.free + action.count, selected.selection.owned),
                otherDecks: selected.selection.otherDecks - (action.emptied ? 1 : 0),
              },
            }
          : selected,
      );
    case "similarRequested":
      return { ...state, similar: { oracleId: action.oracleId, list: "loading" } };
    case "similarArrived":
      return state.similar?.oracleId === action.oracleId
        ? { ...state, similar: { oracleId: action.oracleId, list: action.list } }
        : state;
  }
}
