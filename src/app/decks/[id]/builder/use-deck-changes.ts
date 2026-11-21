import { useRef, useTransition, type Dispatch } from "react";
import type { Board, Bracket, DeckLine, OtherDeckUse } from "@/modules/decks";
import { headingMoved } from "@/modules/decks/client";
import { NOT_UNDERSTOOD_TEXT, settle, type Outcome } from "./answer";
import type { BuilderDeck } from "./builder-deck";
import {
  copiesOnBoards,
  type BuilderAction,
  type BuilderMessage,
  type BuilderState,
} from "./builder-state";
import { setTargetBracketAction } from "./bracket/actions";
import {
  entryDetailsAction,
  headingAction,
  moveLineAction,
  noteAction,
  setQuantityAction,
  type HeadingChange,
} from "./list/actions";
import { addLandsAction } from "./mana-base/actions";
import { swapCardsAction } from "./cuts/actions";
import { takeFromDeckAction } from "./selection/actions";
import type { LineDetails } from "./selection/role-field";
import type { Selection } from "./selection/selection";

// Every change the builder makes to the deck: show it at once where it can, save it with a server
// action, then show the deck as the server now has it. The deck and the message live in the
// reducer (builder-state.ts); this hook sends the changes and dispatches what they did.

export type DeckChanges = Readonly<{
  /** A change is being saved. */
  isSaving: boolean;
  isSavingTarget: boolean;
  add: (board: Board, amount?: number) => void;
  changeLine: (line: DeckLine, next: number) => void;
  moveLine: (line: DeckLine, to: Board) => void;
  swapCards: (cutOracleId: string, cutName: string, addOracleId: string, addName: string) => void;
  addLands: (
    lands: ReadonlyArray<Readonly<{ oracleId: string; quantity: number }>>,
    count: number,
    customText?: string,
  ) => void;
  setLineHeading: (line: DeckLine, heading: string | null) => void;
  moveHeading: (heading: string, direction: "up" | "down") => void;
  renameHeading: (from: string, to: string | null) => void;
  setGrouping: (grouping: BuilderDeck["grouping"]) => void;
  setLineDetails: (line: DeckLine, details: LineDetails) => void;
  setLineNote: (line: DeckLine, note: string | null) => void;
  takeFrom: (use: OtherDeckUse, count: number) => void;
  changeTarget: (target: Bracket | null) => void;
  /** A printing was chosen (design doc 24): the fresh deck and what to say about it. */
  printingChosen: (fresh: BuilderDeck, text: string) => void;
  showMessage: (message: BuilderMessage) => void;
}>;

const MOST_ON_A_LINE = 99;

export function useDeckChanges(
  deckId: number,
  state: BuilderState,
  dispatch: Dispatch<BuilderAction>,
  /** Selects the card again after the deck changed under it (another printing). */
  reselect: (selection: Selection, cards: BuilderDeck["cards"]) => void,
  loadOtherDecks: (oracleId: string) => void,
): DeckChanges {
  const { deck, selected } = state;
  const [isSaving, startSaving] = useTransition();
  const [isSavingTarget, startSavingTarget] = useTransition();
  // Counts the changes sent, so only the newest one's answer is shown.
  const latestChange = useRef(0);

  const showMessage = (message: BuilderMessage) => dispatch({ type: "messageShown", message });
  const showOk = (text: string) => showMessage({ tone: "ok", text });
  const showError = (text: string) => showMessage({ tone: "error", text });

  /**
   * Shows what a change did, unless a later change has been sent since. A refused change that
   * `undoable` guessed at goes back to the deck as the server has it.
   */
  function showOutcome(
    request: number,
    outcome: Outcome<BuilderDeck>,
    text: string,
    undoable?: BuilderDeck,
  ) {
    if (request !== latestChange.current) return; // a later change will bring the fresh deck
    if (outcome.ok) {
      dispatch({ type: "deckReplaced", deck: outcome.value });
      showOk(text);
      return;
    }
    showError(outcome.error.message);
    if (undoable !== undefined) {
      dispatch({ type: "deckReplaced", deck: outcome.error.deck ?? undoable });
    }
  }

  /** Saves a new quantity for one card on one board; the deck updates at once where it can. */
  function saveQuantity(
    change: { oracleId: string; printingId?: string; board: Board; quantity: number },
    done: string,
  ) {
    const request = ++latestChange.current;
    // A card new to the deck gets a provisional line made from its grid card, so its problems and
    // statistics show before the server answers (design doc 19).
    dispatch({ type: "quantityGuessed", change, gridCard: selected?.gridCard ?? null });
    startSaving(async () => {
      const result = settle(await setQuantityAction({ deckId, ...change }), NOT_UNDERSTOOD_TEXT);
      showOutcome(request, result, done);
    });
  }

  function add(board: Board, amount = selected?.quantity ?? 1) {
    if (selected === null) return;
    const { selection } = selected;
    const toAdd = Math.max(1, Math.min(MOST_ON_A_LINE, amount));
    const current = copiesOnBoards(deck, selection.oracleId)[board] ?? 0;
    const next = board === "commander" ? 1 : Math.min(MOST_ON_A_LINE, current + toAdd);
    const added = next - current;
    saveQuantity(
      { oracleId: selection.oracleId, printingId: selection.printingId, board, quantity: next },
      board === "commander"
        ? `${selection.name} is now a commander.`
        : `Added ${added} ${selection.name} (now ${next}${board === "side" ? " in the sideboard" : board === "maybe" ? " on the maybeboard" : ""}${added < toAdd ? ", the most one line can hold" : ""}).`,
    );
    dispatch({ type: "addedToBoard", board, quantity: next });
  }

  function changeLine(line: DeckLine, next: number) {
    saveQuantity(
      {
        oracleId: line.oracleId,
        board: line.board,
        quantity: Math.max(0, Math.min(MOST_ON_A_LINE, next)),
      },
      next <= 0 ? `Removed ${line.name}.` : `${line.name}: now ${next}.`,
    );
  }

  /** Moves a line to another board (design doc 32); the deck shows the move at once. */
  function moveLine(line: DeckLine, to: Board) {
    const request = ++latestChange.current;
    dispatch({ type: "lineMoved", line, to });
    startSaving(async () => {
      const result = settle(
        await moveLineAction({ deckId, oracleId: line.oracleId, from: line.board, to }),
        NOT_UNDERSTOOD_TEXT,
      );
      showOutcome(
        request,
        result,
        to === "maybe"
          ? `Moved ${line.name} to the maybeboard.`
          : `Moved ${line.name} into the deck.`,
      );
    });
  }

  function swapCards(cutOracleId: string, cutName: string, addOracleId: string, addName: string) {
    const request = ++latestChange.current;
    startSaving(async () => {
      const result = settle(
        await swapCardsAction({ deckId, cutOracleId, addOracleId }),
        "That swap wasn't understood.",
      );
      showOutcome(request, result, `Swapped ${cutName} (to maybeboard) for ${addName}.`);
    });
  }

  /** Adds the mana base panel's lands (design doc 35) and shows the deck the server now has. */
  function addLands(
    lands: ReadonlyArray<Readonly<{ oracleId: string; quantity: number }>>,
    count: number,
    customText?: string,
  ) {
    const request = ++latestChange.current;
    startSaving(async () => {
      const result = settle(
        await addLandsAction({ deckId, lands: [...lands] }),
        "Those lands weren't understood.",
      );
      showOutcome(
        request,
        result,
        customText ?? `Added ${count} ${count === 1 ? "land" : "lands"}.`,
      );
    });
  }

  /**
   * Saves a heading change (design doc 34) and shows the deck as the server now has it. `local`
   * changes the deck in hand at once, so the list regroups before the answer comes.
   */
  function saveHeadings(change: HeadingChange, text: string, local: BuilderAction | null) {
    const request = ++latestChange.current;
    if (local !== null) dispatch(local);
    startSaving(async () => {
      const result = settle(await headingAction(change), NOT_UNDERSTOOD_TEXT);
      showOutcome(request, result, text, deck);
    });
  }

  function setLineHeading(line: DeckLine, heading: string | null) {
    saveHeadings(
      { kind: "set", deckId, oracleId: line.oracleId, board: line.board, heading },
      heading === null ? `${line.name}: no heading.` : `${line.name}: under ${heading}.`,
      { type: "lineEdited", line, patch: { heading } },
    );
  }

  function moveHeading(heading: string, direction: "up" | "down") {
    const order = headingMoved(deck.headings, heading, direction);
    saveHeadings({ kind: "order", deckId, order }, `Moved ${heading} ${direction}.`, {
      type: "headingsOrdered",
      order,
    });
  }

  function renameHeading(from: string, to: string | null) {
    saveHeadings(
      { kind: "rename", deckId, from, to },
      to === null ? `Cleared ${from}.` : `Renamed ${from} to ${to.trim()}.`,
      null,
    );
  }

  function setGrouping(grouping: BuilderDeck["grouping"]) {
    saveHeadings(
      { kind: "grouping", deckId, grouping },
      grouping === "custom" ? "Grouped by your headings." : "Grouped by card type.",
      { type: "groupingChosen", grouping },
    );
  }

  /** Saves a line's role or pin (design doc 61), showing it at once and reverting on failure. */
  function setLineDetails(line: DeckLine, details: LineDetails) {
    const request = ++latestChange.current;
    dispatch({ type: "lineEdited", line, patch: details });
    startSaving(async () => {
      const result = settle(
        await entryDetailsAction({
          deckId,
          oracleId: line.oracleId,
          board: line.board,
          ...details,
        }),
        NOT_UNDERSTOOD_TEXT,
      );
      const what =
        details.pinned !== undefined
          ? details.pinned
            ? "pinned"
            : "unpinned"
          : details.role === null
            ? "role cleared"
            : "role saved";
      showOutcome(request, result, `${line.name}: ${what}.`, deck);
    });
  }

  function setLineNote(line: DeckLine, note: string | null) {
    const request = ++latestChange.current;
    dispatch({ type: "lineEdited", line, patch: { note } });
    startSaving(async () => {
      const result = settle(
        await noteAction({ deckId, oracleId: line.oracleId, board: line.board, note }),
        NOT_UNDERSTOOD_TEXT,
      );
      showOutcome(
        request,
        result,
        note === null ? `${line.name}: note cleared.` : `${line.name}: note saved.`,
        deck,
      );
    });
  }

  /** Takes copies out of another deck so they're free here (task 42); this deck stays as it is. */
  function takeFrom(use: OtherDeckUse, count: number) {
    if (selected === null) return;
    const { selection } = selected;
    startSaving(async () => {
      const result = settle(
        await takeFromDeckAction({
          deckId,
          fromDeckId: use.deckId,
          oracleId: selection.oracleId,
          count,
        }),
        NOT_UNDERSTOOD_TEXT,
      );
      if (!result.ok) {
        showError(result.error.message);
        return;
      }
      dispatch({ type: "deckReplaced", deck: result.value });
      const left = use.quantity - count;
      dispatch({ type: "copiesTaken", oracleId: selection.oracleId, count, emptied: left === 0 });
      loadOtherDecks(selection.oracleId);
      showOk(
        `Took ${count} ${selection.name} out of ${use.name}${left === 0 ? "" : ` (it has ${left} left)`}.`,
      );
    });
  }

  function changeTarget(target: Bracket | null) {
    const before = state.targetBracket;
    dispatch({ type: "targetBracketSet", target });
    startSavingTarget(async () => {
      const result = settle(
        await setTargetBracketAction({ deckId, target }),
        "That bracket wasn't understood.",
      );
      if (!result.ok) {
        dispatch({ type: "targetBracketSet", target: before });
        showError(result.error.message);
      }
    });
  }

  function printingChosen(fresh: BuilderDeck, text: string) {
    dispatch({ type: "deckReplaced", deck: fresh });
    showOk(text);
    if (selected === null) return;
    const line = fresh.lines.find((each) => each.oracleId === selected.selection.oracleId);
    if (line !== undefined && line.printingId !== selected.selection.printingId) {
      reselect({ ...selected.selection, printingId: line.printingId }, fresh.cards);
    }
  }

  return {
    isSaving,
    isSavingTarget,
    add,
    changeLine,
    moveLine,
    swapCards,
    addLands,
    setLineHeading,
    moveHeading,
    renameHeading,
    setGrouping,
    setLineDetails,
    setLineNote,
    takeFrom,
    changeTarget,
    printingChosen,
    showMessage,
  };
}
