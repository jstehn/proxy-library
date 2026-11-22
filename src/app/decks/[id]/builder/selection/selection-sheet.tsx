"use client";
import type { Dispatch } from "react";
import type { Format, SuggestionCard } from "@/modules/decks";
import { copyLimitFor, formatRules } from "@/modules/decks/client";
import {
  copiesOnBoards,
  type BuilderAction,
  type SelectedState,
  type SimilarCards,
} from "../builder-state";
import type { BuilderDeck } from "../builder-deck";
import type { DeckChanges } from "../use-deck-changes";
import type { Selecting } from "../use-selection";
import { HeadingField } from "./heading-field";
import { NoteField } from "./note-field";
import { PrintingPicker } from "./printing-picker";
import { RoleField } from "./role-field";
import type { DeckStepping } from "./deck-steps";
import { SelectedCard } from "./selected-card";

// The selected card's sheet and the fields under it: its heading, note, role and printing. On wide
// screens it sticks to the bottom of the collection column; on a phone it floats in the middle of
// the screen over whichever tab is active (clear of the bottom nav), so inspecting a card keeps
// your place, and Previous and Next step through the deck without closing it.

const FIELD_BOX = "border-t border-border-subtle bg-background p-3";

export function SelectionSheet(props: {
  deckId: number;
  format: Format;
  deck: BuilderDeck;
  selected: SelectedState;
  similar: SimilarCards | null;
  isLargeScreen: boolean;
  changes: DeckChanges;
  selecting: Selecting;
  stepping: DeckStepping | null;
  dispatch: Dispatch<BuilderAction>;
}) {
  const { deck, selected, changes, dispatch } = props;
  const { selection } = selected;
  const selectedCopyLimit =
    selection.copyLimit ?? copyLimitFor(props.format, deck.rules[selection.oracleId]);
  const ownLines = deck.lines.filter((line) => line.oracleId === selection.oracleId);

  return (
    <>
      {/* On a phone the page behind is dimmed, above the Top button, and a tap on it closes. */}
      {!props.isLargeScreen && (
        <div
          aria-hidden
          onClick={() => dispatch({ type: "selectionCleared" })}
          className="fixed inset-0 z-40 bg-black/50"
        />
      )}
      <div
        className={
          props.isLargeScreen
            ? "sticky bottom-2 z-20 max-h-[65dvh] overflow-y-auto overscroll-contain rounded-lg shadow-xl"
            : "fixed inset-x-3 top-[calc(50%-2rem)] z-40 max-h-[80dvh] -translate-y-1/2 overflow-y-auto overscroll-contain rounded-lg shadow-xl md:top-1/2"
        }
      >
        <SelectedCard
          selection={{ ...selection, inDeck: copiesOnBoards(deck, selection.oracleId) }}
          detail={selected.detail}
          quantity={selected.quantity}
          onQuantity={(quantity) => dispatch({ type: "quantityChosen", quantity })}
          onAdd={changes.add}
          copyLimit={selectedCopyLimit}
          deckId={props.deckId}
          isCommanderDeck={formatRules(props.format).usesColorIdentity}
          onClose={() => dispatch({ type: "selectionCleared" })}
          similar={props.similar?.oracleId === selection.oracleId ? props.similar.list : null}
          onShowSimilar={() => props.selecting.showSimilar(selection.oracleId)}
          onSelectSimilar={(card: SuggestionCard) => props.selecting.selectSuggestion(card)}
          otherDecks={selected.otherDecks}
          onTake={changes.takeFrom}
          stepping={props.stepping}
        />
        {ownLines
          .filter((line) => line.board === "main")
          .map((line) => (
            <div key={`heading-${line.oracleId}-${line.heading ?? ""}`} className={FIELD_BOX}>
              <HeadingField
                line={line}
                headings={deck.headings}
                busy={changes.isSaving}
                onSave={changes.setLineHeading}
              />
            </div>
          ))}
        {ownLines.map((line) => (
          <div key={`note-${line.oracleId}-${line.board}-${line.note ?? ""}`} className={FIELD_BOX}>
            <NoteField
              line={line}
              showBoard={ownLines.length > 1}
              busy={changes.isSaving}
              onSave={changes.setLineNote}
            />
            {line.board !== "maybe" && (
              <div
                key={`role-${line.role ?? ""}`}
                className="border-border-subtle mt-3 border-t pt-3"
              >
                <RoleField line={line} busy={changes.isSaving} onSave={changes.setLineDetails} />
              </div>
            )}
          </div>
        ))}
        {ownLines.length > 0 && (
          <div className={FIELD_BOX}>
            <PrintingPicker
              key={selection.oracleId}
              deckId={props.deckId}
              lines={ownLines}
              onChosen={changes.printingChosen}
              onError={(text) => changes.showMessage({ tone: "error", text })}
            />
          </div>
        )}
      </div>
    </>
  );
}
