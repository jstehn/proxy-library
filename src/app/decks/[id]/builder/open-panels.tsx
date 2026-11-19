"use client";
import type { Dispatch } from "react";
import type { Format } from "@/modules/decks";
import { CutsPanel } from "./cuts/cuts-panel";
import { DraftPanel } from "./draft/draft-panel";
import { ManaBasePanel } from "./mana-base/mana-base-panel";
import { PrimerPanel } from "./primer/primer-panel";
import { SnapshotsPanel } from "./snapshots/snapshots-panel";
import { SuggestionsPanel } from "./suggestions/suggestions-panel";
import { TestHandPanel } from "./test-hand/test-hand-panel";
import { TokensPanel } from "./tokens/tokens-panel";
import type { BuilderAction, BuilderState, PanelName } from "./builder-state";
import type { DeckChanges } from "./use-deck-changes";
import type { Selecting } from "./use-selection";

// The panels the buttons above the deck list have opened, each closing itself with its ✕.

export function OpenPanels(props: {
  deckId: number;
  format: Format;
  /** Seeds the test hands' shuffles (made by the server: ADR 0008's implementation note). */
  seed: string;
  state: BuilderState;
  /** Changes whenever the deck's contents do, so panels can follow the deck. */
  deckKey: string;
  changes: DeckChanges;
  selecting: Selecting;
  dispatch: Dispatch<BuilderAction>;
}) {
  const { deckId, format, state, deckKey, changes, selecting, dispatch } = props;
  const { deck, openPanels, targetBracket } = state;
  const close = (panel: PanelName) => () => dispatch({ type: "panelClosed", panel });
  // The panels that weigh the bracket also follow its target.
  const deckAndTargetKey = `${deckKey}|${targetBracket ?? ""}`;

  return (
    <>
      {openPanels.primer && (
        <PrimerPanel
          deckId={deckId}
          lines={deck.lines}
          cards={deck.cards}
          onSaved={(text) => changes.showMessage({ tone: "ok", text })}
          onError={(text) => changes.showMessage({ tone: "error", text })}
          onClose={close("primer")}
        />
      )}
      {openPanels.draft && (
        <DraftPanel
          deckId={deckId}
          deckKey={deckAndTargetKey}
          format={format}
          onAdd={changes.addLands}
          onClose={close("draft")}
          busy={changes.isSaving}
        />
      )}
      {openPanels.suggestions && (
        <SuggestionsPanel
          deckId={deckId}
          deckKey={deckAndTargetKey}
          onSelect={selecting.selectSuggestion}
          onClose={close("suggestions")}
        />
      )}
      {openPanels.cuts && (
        <CutsPanel
          deckId={deckId}
          deckKey={deckAndTargetKey}
          lines={deck.lines}
          format={format}
          targetBracket={targetBracket}
          onMove={changes.moveLine}
          onSwap={changes.swapCards}
          onSelect={selecting.selectFromDeck}
          onClose={close("cuts")}
          busy={changes.isSaving}
        />
      )}
      {openPanels.manaBase && (
        <ManaBasePanel
          deckId={deckId}
          deckKey={deckKey}
          onAdd={changes.addLands}
          onClose={close("manaBase")}
          busy={changes.isSaving}
        />
      )}
      {openPanels.testHand && (
        <TestHandPanel
          lines={deck.lines}
          format={format}
          seed={props.seed}
          cards={deck.cards}
          onClose={close("testHand")}
        />
      )}
      {openPanels.snapshots && (
        <SnapshotsPanel
          deckId={deckId}
          deckKey={deckKey}
          busy={changes.isSaving}
          onRestored={(fresh, text) => {
            dispatch({ type: "deckReplaced", deck: fresh });
            changes.showMessage({ tone: "ok", text });
          }}
          onError={(text) => changes.showMessage({ tone: "error", text })}
          onClose={close("snapshots")}
        />
      )}
      {openPanels.tokens && (
        <TokensPanel deckId={deckId} deckKey={deckKey} showPrintLink onClose={close("tokens")} />
      )}
    </>
  );
}
