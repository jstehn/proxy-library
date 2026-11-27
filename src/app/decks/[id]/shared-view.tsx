"use client";

import { type Tag } from "@/shared/mtg";
import { useState } from "react";
import { CardPreviewDialog } from "@/app/_components/card-preview";
import type { PrintingCard } from "@/modules/catalog";
import type {
  Bracket,
  BracketRule,
  CardRules,
  DeckCombo,
  DeckLine,
  Format,
  Grouping,
  TokenLine,
} from "@/modules/decks";
import { bracketLine, estimateBracket } from "@/modules/decks/client";
import { wrapIndex, type CardStepping } from "@/ui/mtg/card-art-logic";
import { BracketPanel } from "./builder/bracket/bracket-panel";
import { DeckList } from "./builder/list/deck-list";
import { deckOrder } from "./builder/list/groups";
import { problemsOf } from "./builder/derive";
import { StatsPanel } from "./builder/stats/stats-panel";
import { TestHandPanel } from "./builder/test-hand/test-hand-panel";
import { TokensPanel } from "./builder/tokens/tokens-panel";
import { Button } from "@/ui/button";

// Someone else's shared deck, read-only (design doc 21): its list (with how many of each card
// you own), its statistics and problems as its owner has them, test hands, and the list as text
// to paste into a deck of your own.

export function SharedDeckView(props: {
  lines: readonly DeckLine[];
  rules: Readonly<Record<string, CardRules>>;
  cards: Readonly<Record<string, PrintingCard>>;
  format: Format;
  /** The bracket its owner is aiming for (design doc 31, section 5.3). */
  targetBracket: Bracket | null;
  seed: string;
  ownerName: string;
  yourCopies?: Readonly<Record<string, number>>;
  listText: string;
  /** The owner's grouping and headings (design doc 34, decision 4). */
  grouping: Grouping;
  headings: readonly string[];
  /** Tokens, emblems, and helper cards created by counted cards (design doc 42). */
  tokens?: readonly TokenLine[];
  /** Two-card combos detected in the deck (design doc 52). */
  combos?: readonly DeckCombo[];
}) {
  const [highlighted, setHighlightedRole] = useState<Tag | null>(null);
  const [highlightedRule, setHighlightedRule] = useState<BracketRule | null>(null);
  const setHighlighted = (tag: Tag | null) => {
    setHighlightedRole(tag);
    setHighlightedRule(null);
  };
  const highlightRule = (rule: BracketRule | null) => {
    setHighlightedRule(rule);
    setHighlightedRole(null);
  };
  const estimate = estimateBracket(props.format, props.lines.map(bracketLine), {
    combos: props.combos,
  });
  const highlightedNames = new Set(
    estimate?.findings.find((finding) => finding.rule === highlightedRule)?.cards ?? [],
  );
  const [showTestHand, setShowTestHand] = useState(false);
  const [showTokens, setShowTokens] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const previewOrder = deckOrder(props.lines, props.grouping, props.headings).filter(
    (line) => props.cards[line.printingId] !== undefined,
  );
  const activePreviewLine = previewIndex !== null ? (previewOrder[previewIndex] ?? null) : null;
  const activePreviewCard =
    activePreviewLine !== null ? (props.cards[activePreviewLine.printingId] ?? null) : null;
  const previewStepping: CardStepping | null =
    previewIndex !== null && previewOrder.length > 1
      ? {
          position: previewIndex + 1,
          total: previewOrder.length,
          onPrevious: () =>
            setPreviewIndex((current) => wrapIndex(current ?? 0, -1, previewOrder.length)),
          onNext: () =>
            setPreviewIndex((current) => wrapIndex(current ?? 0, 1, previewOrder.length)),
        }
      : null;

  function openPreview(line: DeckLine) {
    const index = previewOrder.findIndex((candidate) => candidate.oracleId === line.oracleId);
    if (index !== -1) setPreviewIndex(index);
  }

  const problems = problemsOf(props.format, props.lines, props.rules);
  const problemsByName = new Map<string, string[]>();
  for (const problem of problems) {
    if (problem.name !== null) {
      problemsByName.set(problem.name, [...(problemsByName.get(problem.name) ?? []), problem.text]);
    }
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <DeckList
          lines={props.lines}
          cards={props.cards}
          problemsByName={problemsByName}
          onChange={() => undefined}
          onSelect={openPreview}
          busy={false}
          highlighted={highlighted}
          highlightedNames={highlightedNames}
          readOnly
          yourCopies={props.yourCopies}
          grouping={props.grouping}
          headings={props.headings}
        />
        <details className="text-sm">
          <summary className="cursor-pointer underline">The list as text</summary>
          <p className="text-muted my-2 text-xs">
            Paste it into one of your decks to build your own version.
          </p>
          <textarea
            readOnly
            rows={10}
            aria-label="Deck list as text"
            value={props.listText}
            className="border-line w-full rounded-md border bg-transparent p-2 font-mono text-sm"
          />
        </details>
      </div>
      <aside aria-label="About the deck" className="flex w-full flex-col gap-4 lg:w-[26rem]">
        <section aria-label="Problems" className="text-sm">
          {problems.length === 0 ? (
            <p className="text-success-text">
              Ready to play: {props.ownerName} owns everything, and it follows the format&apos;s
              rules.
            </p>
          ) : (
            <ul className="text-warning-text flex flex-col gap-1">
              {problems
                .filter((problem) => problem.name === null)
                .map((problem) => (
                  <li key={problem.text}>• {problem.text}</li>
                ))}
              {problemsByName.size > 0 && (
                <li>
                  • {problemsByName.size} {problemsByName.size === 1 ? "card has" : "cards have"} a
                  problem for {props.ownerName} (marked ⚠).
                </li>
              )}
            </ul>
          )}
        </section>
        {estimate !== null && (
          <BracketPanel
            estimate={estimate}
            target={props.targetBracket}
            highlighted={highlightedRule}
            onHighlight={highlightRule}
          />
        )}
        <StatsPanel
          lines={props.lines}
          format={props.format}
          highlighted={highlighted}
          onHighlight={setHighlighted}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            aria-expanded={showTestHand}
            onClick={() => setShowTestHand((value) => !value)}
            variant="secondary"
            size="sm"
          >
            {showTestHand ? "Hide test hand" : "Test hand"}
          </Button>
          {props.tokens !== undefined && props.tokens.length > 0 && (
            <Button
              type="button"
              aria-expanded={showTokens}
              onClick={() => setShowTokens((value) => !value)}
              variant="secondary"
              size="sm"
            >
              {showTokens ? "Hide tokens" : `Tokens (${props.tokens.length})`}
            </Button>
          )}
        </div>
        {showTestHand && (
          <TestHandPanel
            lines={props.lines}
            format={props.format}
            seed={props.seed}
            cards={props.cards}
            onClose={() => setShowTestHand(false)}
          />
        )}
        {showTokens && props.tokens !== undefined && (
          <TokensPanel tokens={props.tokens} onClose={() => setShowTokens(false)} />
        )}
      </aside>
      {activePreviewCard !== null && (
        <CardPreviewDialog
          printing={activePreviewCard}
          open={activePreviewCard !== null}
          onClose={() => setPreviewIndex(null)}
          stepping={previewStepping}
        />
      )}
    </div>
  );
}
