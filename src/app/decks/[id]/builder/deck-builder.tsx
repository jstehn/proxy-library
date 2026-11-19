"use client";
import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { ScrollToTopButton } from "@/app/_components/scroll-to-top";
import { bracketWarningText } from "@/app/decks/labels";
import type { Bracket, Format } from "@/modules/decks";
import {
  bracketWarning,
  bracketLine,
  deckSize,
  estimateBracket,
  isCounted,
} from "@/modules/decks/client";
import { BracketPanel } from "./bracket/bracket-panel";
import type { BuilderDeck } from "./builder-deck";
import { builderReducer, copiesOnBoards, initialBuilderState } from "./builder-state";
import { CollectionPanel } from "./collection/collection-panel";
import { useBrowse } from "./collection/use-browse";
import { commanderColorsOf, problemsOf } from "./derive";
import { DeckList } from "./list/deck-list";
import { OpenPanels } from "./open-panels";
import { PanelButtons } from "./panel-buttons";
import { countedCopies } from "./selection/selection";
import { SelectionSheet } from "./selection/selection-sheet";
import { StatsPanel } from "./stats/stats-panel";
import { useDeckChanges } from "./use-deck-changes";
import { useSelection } from "./use-selection";

// The deck builder (design doc 14, section 2): your collection as card images on the left, the
// deck and its live statistics on the right. On a phone, two tabs. The deck lives in the builder's
// reducer (builder-state.ts) so the statistics change instantly; each change is saved by a server
// action, which sends back the deck as the server now has it (use-deck-changes.ts).

const LARGE_SCREEN_QUERY = "(min-width: 64rem)";

function subscribeLargeScreen(onChange: () => void) {
  const media = window.matchMedia(LARGE_SCREEN_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getLargeScreenSnapshot() {
  return window.matchMedia(LARGE_SCREEN_QUERY).matches;
}

function getLargeScreenServerSnapshot() {
  return false;
}

export function DeckBuilder(props: {
  deckId: number;
  format: Format;
  initialDeck: BuilderDeck;
  /** The Commander bracket the owner is aiming for (design doc 31). */
  targetBracket: Bracket | null;
  /** Seeds the test hands' shuffles (made by the server: ADR 0008's implementation note). */
  seed: string;
}) {
  const { deckId, format } = props;
  const isCommanderDeck = format === "commander";
  const [state, dispatch] = useReducer(
    builderReducer,
    initialBuilderState(props.initialDeck, props.targetBracket),
  );
  const { deck, message, targetBracket, selected } = state;
  const selecting = useSelection(deckId, format, state, dispatch);
  const changes = useDeckChanges(
    deckId,
    state,
    dispatch,
    selecting.reselect,
    selecting.loadOtherDecks,
  );
  const [tab, setTab] = useState<"collection" | "deck">("collection");
  const isLargeScreen = useSyncExternalStore(
    subscribeLargeScreen,
    getLargeScreenSnapshot,
    getLargeScreenServerSnapshot,
  );
  const searchRef = useRef<HTMLInputElement>(null);

  // Worked out from the deck in hand, so they change the moment a card goes in (design doc 19).
  const commanderColors = commanderColorsOf(format, deck.lines, deck.rules);
  const problems = problemsOf(format, deck.lines, deck.rules);
  // The bracket, live like the problems (design doc 31). Null outside Commander.
  const estimate = estimateBracket(format, deck.lines.map(bracketLine), { combos: deck.combos });
  const warning = bracketWarning(estimate, targetBracket);
  const highlightedNames = new Set(
    estimate?.findings.find((finding) => finding.rule === state.highlightedRule)?.cards ?? [],
  );
  // Changes whenever the deck's contents do, so panels can follow the deck.
  const deckKey = deck.lines
    .map((line) => `${line.board}:${line.oracleId}:${line.quantity}`)
    .sort()
    .join(",");
  const [browsing, endRef] = useBrowse(deckId, isCommanderDeck, commanderColors);

  // "/" jumps to the search box from anywhere on the page, as on Scryfall and GitHub; "H" opens
  // or closes the test hand, "S" the suggestions, and Escape closes the selected card.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select") !== null;
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        dispatch({ type: "panelToggled", panel: "testHand" });
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        dispatch({ type: "panelToggled", panel: "suggestions" });
      } else if (event.key === "Escape") {
        dispatch({ type: "selectionCleared" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const problemsByName = new Map<string, string[]>();
  for (const problem of problems) {
    if (problem.name !== null) {
      problemsByName.set(problem.name, [...(problemsByName.get(problem.name) ?? []), problem.text]);
    }
  }
  const deckProblems = problems.filter((problem) => problem.name === null);
  // The maybeboard isn't counted (design doc 32).
  const cardTotal = deck.lines
    .filter((line) => isCounted(line.board))
    .reduce((sum, line) => sum + line.quantity, 0);

  const selectedSheet =
    selected !== null ? (
      <SelectionSheet
        deckId={deckId}
        format={format}
        deck={deck}
        selected={selected}
        similar={state.similar}
        isLargeScreen={isLargeScreen}
        changes={changes}
        selecting={selecting}
        dispatch={dispatch}
      />
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <ScrollToTopButton />
      {/* Phone: two tabs. Wide screens show both sides at once. */}
      <div role="tablist" aria-label="Builder" className="flex gap-2 lg:hidden">
        {(["collection", "deck"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            onClick={() => setTab(option)}
            className={`flex-1 rounded-md py-1.5 text-sm ${tab === option ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}
          >
            {option === "collection" ? "Collection" : `Deck (${cardTotal})`}
          </button>
        ))}
      </div>

      <p role="status" className="min-h-5 text-sm">
        {message && (
          <span
            className={
              message.tone === "ok"
                ? "text-green-700 dark:text-green-400"
                : "text-red-700 dark:text-red-400"
            }
          >
            {message.text}
          </span>
        )}
      </p>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <CollectionPanel
          browsing={browsing}
          endRef={endRef}
          searchRef={searchRef}
          showCommanderColors={isCommanderDeck && commanderColors !== null}
          visibleOnPhone={tab === "collection"}
          selectedOracleId={selected?.selection.oracleId ?? null}
          copiesInDeck={(oracleId) => countedCopies(copiesOnBoards(deck, oracleId))}
          onSelect={selecting.selectFromGrid}
          onAddToMain={() => changes.add("main")}
          onStepQuantity={(by) => dispatch({ type: "quantityStepped", by })}
        >
          {isLargeScreen && selectedSheet}
        </CollectionPanel>

        <aside
          aria-label="The deck"
          className={`w-full flex-col gap-6 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:w-[26rem] lg:overflow-y-auto lg:pr-1 ${tab === "deck" ? "flex" : "hidden lg:flex"}`}
        >
          <section aria-label="Problems" className="flex flex-col gap-1 text-sm">
            {problems.length === 0 ? (
              <p className="text-green-700 dark:text-green-400">
                {cardTotal === 0
                  ? "Empty so far."
                  : "Ready to play: you own everything, and it follows the format's rules."}
              </p>
            ) : (
              <ul className="flex flex-col gap-1 text-red-700 dark:text-red-400">
                {deckProblems.map((problem) => (
                  <li key={problem.text}>• {problem.text}</li>
                ))}
                {problemsByName.size > 0 && (
                  <li>
                    • {problemsByName.size} {problemsByName.size === 1 ? "card has" : "cards have"}{" "}
                    a problem (marked ⚠ below).
                  </li>
                )}
              </ul>
            )}
            {/* Over target is a warning, not a problem: the deck still follows the rules. */}
            {warning !== null && (
              <p className="text-amber-700 dark:text-amber-400">⚠ {bracketWarningText(warning)}</p>
            )}
          </section>
          {estimate !== null && (
            <BracketPanel
              estimate={estimate}
              target={targetBracket}
              onTargetChange={changes.changeTarget}
              saving={changes.isSavingTarget}
              highlighted={state.highlightedRule}
              onHighlight={(rule) => dispatch({ type: "ruleHighlighted", rule })}
            />
          )}
          <StatsPanel
            lines={deck.lines}
            format={format}
            highlighted={state.highlightedRole}
            onHighlight={(tag) => dispatch({ type: "roleHighlighted", tag })}
          />
          <PanelButtons
            format={format}
            openPanels={state.openPanels}
            cardTotal={cardTotal}
            draftTarget={deckSize(format).cards}
            dispatch={dispatch}
          />
          <OpenPanels
            deckId={deckId}
            format={format}
            seed={props.seed}
            state={state}
            deckKey={deckKey}
            changes={changes}
            selecting={selecting}
            dispatch={dispatch}
          />
          <DeckList
            lines={deck.lines}
            cards={deck.cards}
            problemsByName={problemsByName}
            onChange={changes.changeLine}
            onMove={changes.moveLine}
            onSelect={selecting.selectFromDeck}
            busy={changes.isSaving}
            highlighted={state.highlightedRole}
            highlightedNames={highlightedNames}
            grouping={deck.grouping}
            headings={deck.headings}
            onGrouping={changes.setGrouping}
            onMoveHeading={changes.moveHeading}
            onRenameHeading={changes.renameHeading}
          />
        </aside>
      </div>
      {!isLargeScreen && selectedSheet}
    </div>
  );
}
