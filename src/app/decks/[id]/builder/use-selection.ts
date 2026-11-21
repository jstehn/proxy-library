import type { Dispatch } from "react";
import type { BrowseCard, DeckLine, Format, OtherDeckUse, SuggestionCard } from "@/modules/decks";
import { copyLimitFor } from "@/modules/decks/client";
import { valueOr } from "./answer";
import { copiesOnBoards, type BuilderAction, type BuilderState } from "./builder-state";
import type { BuilderDeck } from "./builder-deck";
import { cardDetailAction, otherDecksAction, similarAction } from "./selection/actions";
import type { Selection } from "./selection/selection";

// Selecting a card: from the grid, the deck list, a suggestion or the cuts panel. The state is in
// the reducer; this hook only starts the reads that fill it in (details, other decks, look-alikes).

export type Selecting = Readonly<{
  selectFromGrid: (card: BrowseCard) => void;
  /** A suggestion is selected like a grid card. */
  selectSuggestion: (card: SuggestionCard) => void;
  selectFromDeck: (line: DeckLine) => void;
  /** A card of the deck chosen by name only, as after picking another printing. */
  reselect: (selection: Selection, cards: BuilderDeck["cards"]) => void;
  showSimilar: (oracleId: string) => void;
  loadOtherDecks: (oracleId: string) => void;
}>;

export function useSelection(
  deckId: number,
  format: Format,
  state: BuilderState,
  dispatch: Dispatch<BuilderAction>,
): Selecting {
  const { deck } = state;

  function loadOtherDecks(oracleId: string) {
    dispatch({ type: "otherDecksRequested" });
    void otherDecksAction({ deckId, oracleId }).then((answer) => {
      dispatch({ type: "otherDecksArrived", oracleId, uses: valueOr(answer, []) });
    });
  }

  /** Selects a card. `uses` are its other decks when already known (a deck line has them). */
  function select(
    selection: Selection,
    gridCard: BrowseCard | null,
    uses?: readonly OtherDeckUse[],
    cards: BuilderDeck["cards"] = deck.cards,
  ) {
    const known = uses !== undefined || selection.otherDecks === 0;
    dispatch({
      type: "cardSelected",
      selection,
      gridCard,
      otherDecks: known ? (uses ?? []) : "loading",
    });
    if (!known) loadOtherDecks(selection.oracleId);
    if (cards[selection.printingId] === undefined) {
      void cardDetailAction(selection.printingId).then((answer) => {
        dispatch({
          type: "detailArrived",
          printingId: selection.printingId,
          detail: valueOr(answer, null),
        });
      });
    }
  }

  function selectFromGrid(card: BrowseCard) {
    select(
      {
        oracleId: card.oracleId,
        printingId: card.printingId,
        name: card.name,
        owned: card.owned,
        ownedReal: card.ownedReal,
        inDeck: copiesOnBoards(deck, card.oracleId),
        otherDecks: card.otherDecks,
        free: card.free,
        misfit: card.misfit,
        priceCents: card.priceCents,
        tags: card.roles,
        bracketFlags: card.bracketFlags,
        copyLimit: copyLimitFor(format, card.rules),
      },
      card,
    );
  }

  function selectFromDeck(line: DeckLine) {
    select(
      {
        oracleId: line.oracleId,
        printingId: line.printingId,
        name: line.name,
        owned: line.owned,
        ownedReal: line.ownedReal,
        inDeck: copiesOnBoards(deck, line.oracleId),
        otherDecks: line.otherDecks.length,
        free: line.free,
        misfit: null,
        priceCents: line.priceCents,
        tags: line.roles,
        bracketFlags: line.bracketFlags,
        copyLimit: copyLimitFor(format, deck.rules[line.oracleId]),
      },
      null,
      line.otherDecks,
    );
  }

  function showSimilar(oracleId: string) {
    dispatch({ type: "similarRequested", oracleId });
    void similarAction({ deckId, oracleId }).then((answer) => {
      dispatch({ type: "similarArrived", oracleId, list: valueOr(answer, null) });
    });
  }

  return {
    selectFromGrid,
    selectSuggestion: selectFromGrid,
    selectFromDeck,
    reselect: (selection, cards) => select(selection, null, undefined, cards),
    showSimilar,
    loadOtherDecks,
  };
}
