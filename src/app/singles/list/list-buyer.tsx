"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ListQuote, PrintingPreference, QuoteLine } from "@/modules/store";
import { Cents } from "@/shared/kernel";
import { buyListAction, quoteListAction, type BuyListResult } from "./actions";

// The list on the left, what it would buy on the right (design doc 15, section 3.1). The quote
// follows the text after a pause in typing; buying sends exactly the lines shown.

const WAIT_MILLISECONDS = 400;
const field =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";
const money = (cents: number) => Cents.format(Cents.of(cents));

export function ListBuyer(props: { startingText: string; balanceCents: number }) {
  const router = useRouter();
  const [text, setText] = useState(props.startingText);
  const [preference, setPreference] = useState<PrintingPreference>("cheapest");
  const [onlyMissing, setOnlyMissing] = useState(true);
  /** Printings picked by hand, by line number. Reset when the text changes. */
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [quote, setQuote] = useState<ListQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [result, setResult] = useState<BuyListResult | null>(null);
  const [isBuying, startBuying] = useTransition();
  const latestQuote = useRef(0);
  /** Bumped to ask for a fresh quote after buying (what you own has changed). */
  const [quoteRound, setQuoteRound] = useState(0);

  // Quote after a pause in typing. Only the newest request's answer is shown.
  useEffect(() => {
    const request = ++latestQuote.current;
    const timer = setTimeout(() => {
      setIsQuoting(true);
      void quoteListAction({ text, preference, onlyMissing, chosen }).then((answer) => {
        if (request !== latestQuote.current) return;
        setQuote(answer);
        setIsQuoting(false);
      });
    }, WAIT_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [text, preference, onlyMissing, chosen, quoteRound]);

  const toBuy = quote?.lines.filter((line) => line.choice !== null && line.toBuy > 0) ?? [];
  const balanceAfter = props.balanceCents - (quote?.totalCents ?? 0);

  function buy() {
    if (quote === null) return;
    const lines = toBuy.flatMap((line) =>
      line.choice === null
        ? []
        : [{ printingId: line.choice.printingId, finish: line.finish, quantity: line.toBuy }],
    );
    startBuying(async () => {
      const answer = await buyListAction({ lines, expectedTotal: quote.totalCents });
      setResult(answer);
      if (answer.ok || answer.pricesChanged) setQuoteRound((round) => round + 1);
      if (answer.ok) router.refresh(); // the balance in the header
    });
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <section aria-label="Your list" className="flex flex-col gap-3 lg:w-96">
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setChosen({});
            setResult(null);
          }}
          rows={14}
          aria-label="Cards to buy"
          placeholder={"4 Lightning Bolt\n1 Sol Ring (C21) 263\n2 The One Ring *F*"}
          className={`${field} font-mono`}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyMissing}
            onChange={(event) => setOnlyMissing(event.target.checked)}
          />
          Only buy what I don&apos;t already own
        </label>
        <fieldset className="flex items-center gap-3 text-sm">
          <legend className="sr-only">Which printing</legend>
          <span className="text-zinc-500">Printing:</span>
          {(["cheapest", "newest"] as const).map((option) => (
            <label key={option} className="flex items-center gap-1">
              <input
                type="radio"
                name="preference"
                checked={preference === option}
                onChange={() => {
                  setPreference(option);
                  setChosen({});
                }}
              />
              {option === "cheapest" ? "Cheapest" : "Newest"}
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-zinc-500">
          A set and number in a line, like <code>(M11) 149</code>, picks that printing. Section
          headers and comments are fine; a sideboard is bought like the rest.
        </p>
      </section>

      <section aria-label="What it would buy" className="flex min-w-0 flex-1 flex-col gap-3">
        {quote === null || quote.lines.length === 0 ? (
          <p className="text-sm text-zinc-500">
            {isQuoting ? "Pricing…" : "Paste a list to see what it would buy."}
          </p>
        ) : (
          <ul
            className={`flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800 ${isQuoting ? "opacity-60" : ""}`}
          >
            {quote.lines.map((line) => (
              <QuoteRow
                key={line.index}
                line={line}
                onChoose={(printingId) =>
                  setChosen((current) => ({ ...current, [line.index]: printingId }))
                }
              />
            ))}
          </ul>
        )}
        {quote !== null && quote.unreadable.length > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Couldn&apos;t read: {quote.unreadable.join(" | ")}
          </p>
        )}
        {quote !== null && quote.leftOut > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Only the first {quote.lines.length} lines are bought at once; {quote.leftOut} left out.
          </p>
        )}

        {quote !== null && quote.cards > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <p className="text-sm">
              Total <strong className="tabular-nums">{money(quote.totalCents)}</strong> · balance
              after{" "}
              <span
                className={`tabular-nums ${balanceAfter < 0 ? "text-red-700 dark:text-red-400" : ""}`}
              >
                {money(balanceAfter)}
              </span>
            </p>
            <button
              type="button"
              onClick={buy}
              disabled={isBuying || isQuoting || balanceAfter < 0}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {isBuying
                ? "Buying…"
                : `Buy ${quote.cards} ${quote.cards === 1 ? "card" : "cards"} for ${money(quote.totalCents)}`}
            </button>
          </div>
        )}
        {quote !== null && balanceAfter < 0 && (
          <p className="text-sm text-red-700 dark:text-red-400">
            That&apos;s more than your balance: remove some lines, or pick cheaper printings.
          </p>
        )}
        <p role="status" className="min-h-5 text-sm">
          {result !== null && (
            <span
              className={
                result.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
              }
            >
              {result.message}
            </span>
          )}
        </p>
      </section>
    </div>
  );
}

function QuoteRow(props: { line: QuoteLine; onChoose: (printingId: string) => void }) {
  const { line } = props;
  const { request, choice } = line;
  const finishLabel = line.finish === "nonfoil" ? "" : ` · ${line.finish}`;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
      <span className="w-8 shrink-0 text-right tabular-nums">{line.toBuy}</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{choice?.name ?? request.name}</span>
        {line.problem !== null && (
          <span className="block text-xs text-amber-700 dark:text-amber-400">⚠ {line.problem}</span>
        )}
        {choice !== null && line.toBuy < request.quantity && (
          <span className="block text-xs text-zinc-500">
            {line.toBuy === 0
              ? `You have ${line.owned}: nothing to buy`
              : `${request.quantity} wanted, you have ${line.owned}`}
          </span>
        )}
      </span>
      {choice !== null && (
        <>
          <select
            value={choice.printingId}
            onChange={(event) => props.onChoose(event.target.value)}
            aria-label={`Printing of ${choice.name}`}
            // On a phone the menu gets its own line under the name; beside it on wider screens.
            className={`${field} order-last ml-11 w-[calc(100%-2.75rem)] text-xs sm:order-none sm:ml-0 sm:w-auto sm:max-w-64`}
          >
            {line.options.map((option) => (
              <option key={option.printingId} value={option.printingId}>
                {option.setCode} #{option.collectorNumber}
                {option.variantLabel === "" ? "" : ` ${option.variantLabel}`} ·{" "}
                {money(option.priceCents)}
              </option>
            ))}
          </select>
          <span className="w-24 shrink-0 text-right tabular-nums">
            {money(line.totalCents)}
            <span className="block text-xs text-zinc-500">
              {money(choice.priceCents)} each{finishLabel}
            </span>
          </span>
        </>
      )}
    </li>
  );
}
