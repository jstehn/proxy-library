"use client";
import { useState } from "react";
import type { PrintingCard } from "@/modules/catalog";
import type { CardRules, DeckLine, Format } from "@/modules/decks";
import type { Tag } from "@/shared/card-search";
import { DeckList } from "./builder/deck-list";
import { problemsOf } from "./builder/derive";
import { StatsPanel } from "./builder/stats-panel";
import { TestHandPanel } from "./builder/test-hand";

// Someone else's shared deck, read-only (design doc 21): its list (with how many of each card
// you own), its statistics and problems as its owner has them, test hands, and the list as text
// to paste into a deck of your own.

export function SharedDeckView(props: {
  lines: readonly DeckLine[];
  rules: Readonly<Record<string, CardRules>>;
  cards: Readonly<Record<string, PrintingCard>>;
  format: Format;
  seed: string;
  ownerName: string;
  yourCopies: Readonly<Record<string, number>>;
  listText: string;
}) {
  const [highlighted, setHighlighted] = useState<Tag | null>(null);
  const [showTestHand, setShowTestHand] = useState(false);
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
          readOnly
          yourCopies={props.yourCopies}
        />
        <details className="text-sm">
          <summary className="cursor-pointer underline">The list as text</summary>
          <p className="my-2 text-xs text-zinc-500">
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
        <StatsPanel
          lines={props.lines}
          format={props.format}
          highlighted={highlighted}
          onHighlight={setHighlighted}
        />
        <div>
          <button
            type="button"
            aria-expanded={showTestHand}
            onClick={() => setShowTestHand((value) => !value)}
            className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
          >
            {showTestHand ? "Hide test hand" : "Test hand"}
          </button>
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
      </aside>
    </div>
  );
}
