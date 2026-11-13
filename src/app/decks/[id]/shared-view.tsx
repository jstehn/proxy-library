"use client";
import { useState } from "react";
import type { PrintingCard } from "@/modules/catalog";
import type {
  Bracket,
  BracketRule,
  CardRules,
  DeckLine,
  Format,
  Grouping,
  TokenLine,
} from "@/modules/decks";
import { bracketLine, estimateBracket } from "@/modules/decks/client";
import type { Tag } from "@/shared/card-search";
import { BracketPanel } from "./builder/bracket-panel";
import { DeckList } from "./builder/deck-list";
import { problemsOf } from "./builder/derive";
import { StatsPanel } from "./builder/stats-panel";
import { TestHandPanel } from "./builder/test-hand";
import { TokensPanel } from "./builder/tokens-panel";

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
  const estimate = estimateBracket(props.format, props.lines.map(bracketLine));
  const highlightedNames = new Set(
    estimate?.findings.find((finding) => finding.rule === highlightedRule)?.cards ?? [],
  );
  const [showTestHand, setShowTestHand] = useState(false);
  const [showTokens, setShowTokens] = useState(false);
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
          onSelect={() => undefined}
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
            className="w-full rounded-md border border-zinc-300 bg-transparent p-2 font-mono text-sm dark:border-zinc-700"
          />
        </details>
      </div>
      <aside aria-label="About the deck" className="flex w-full flex-col gap-4 lg:w-[26rem]">
        <section aria-label="Problems" className="text-sm">
          {problems.length === 0 ? (
            <p className="text-green-700 dark:text-green-400">
              Ready to play: {props.ownerName} owns everything, and it follows the format&apos;s
              rules.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-amber-700 dark:text-amber-400">
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
          <button
            type="button"
            aria-expanded={showTestHand}
            onClick={() => setShowTestHand((value) => !value)}
            className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
          >
            {showTestHand ? "Hide test hand" : "Test hand"}
          </button>
          {props.tokens !== undefined && props.tokens.length > 0 && (
            <button
              type="button"
              aria-expanded={showTokens}
              onClick={() => setShowTokens((value) => !value)}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            >
              {showTokens ? "Hide tokens" : `Tokens (${props.tokens.length})`}
            </button>
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
    </div>
  );
}
