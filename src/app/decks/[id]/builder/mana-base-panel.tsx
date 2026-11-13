"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ManaBasePlan, PlannedLand } from "@/modules/decks";
import { Cents } from "@/shared/kernel";
import { ManaText } from "@/ui/mana";
import { landReasonText, landTargetReasonText } from "../../labels";
import { manaBaseAction } from "./actions";

// Mana base (design doc 35, section 9): how many lands and sources of each color to aim for,
// and lands you could add: yours first (decks share cards), then basics; and store lands to
// consider buying. A starting point from simple rules, not the best mana base.

const WAIT_MILLISECONDS = 600; // let a burst of deck changes settle before asking again

/** The lands to add, as the add action takes them. */
export type LandsToAdd = ReadonlyArray<Readonly<{ oracleId: string; quantity: number }>>;

export function ManaBasePanel(props: {
  deckId: number;
  /** Changes whenever the deck's contents do, so the plan follows the deck. */
  deckKey: string;
  onAdd: (lands: LandsToAdd, count: number) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const { deckId, deckKey } = props;
  const [plan, setPlan] = useState<ManaBasePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    const timer = setTimeout(() => {
      setLoading(true);
      void manaBaseAction(deckId).then((result) => {
        if (request !== latest.current) return; // the deck changed again meanwhile
        setPlan(result);
        setLoading(false);
      });
    }, WAIT_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [deckId, deckKey]);

  const adding = plan?.add.reduce((sum, land) => sum + land.quantity, 0) ?? 0;

  return (
    <section
      aria-label="Mana base"
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Mana base</h2>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close mana base"
          className="text-muted hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ✕
        </button>
      </div>
      <p className="text-muted text-xs">
        A mana base you could start from: a land count and colored sources from rules of thumb,
        filled with lands you own (even ones in other decks), then basics. It only adds lands; which
        to cut is up to you.
      </p>
      {plan === null ? (
        <p className="text-muted">{loading ? "Working it out…" : "Couldn't plan this deck."}</p>
      ) : (
        <>
          <div>
            <p>
              Lands:{" "}
              <span className="font-medium">
                {plan.lands} of ~{plan.landTarget.lands}
              </span>
            </p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {plan.landTarget.reasons.map(landTargetReasonText).join(" · ")}
            </p>
          </div>
          {plan.sources.length > 0 && (
            <ul aria-label="Sources per color" className="flex flex-col gap-0.5">
              {plan.sources.map((source) => (
                <li key={source.color} className="flex flex-wrap items-center gap-2">
                  <ManaText text={`{${source.color}}`} />
                  <span
                    className={
                      source.have >= source.target ? "" : "text-amber-700 dark:text-amber-400"
                    }
                  >
                    {source.have} of {source.target} sources
                  </span>
                  {source.heaviestCost > 1 && (
                    <span className="text-muted text-xs">
                      (a card costs{" "}
                      <ManaText text={`{${source.color}}`.repeat(source.heaviestCost)} />)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {plan.over > 0 && (
            <p>
              The deck has {plan.lands} lands, {plan.over} over the ~{plan.landTarget.lands} target.
            </p>
          )}
          {plan.add.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-muted text-xs font-medium uppercase">Lands you could add</h3>
              <LandList lands={plan.add} />
              <button
                type="button"
                disabled={props.busy}
                onClick={() =>
                  props.onAdd(
                    plan.add.map((land) => ({
                      oracleId: land.card.oracleId,
                      quantity: land.quantity,
                    })),
                    adding,
                  )
                }
                className="self-start rounded-md bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Add these {adding} lands
              </button>
            </div>
          )}
          {plan.over === 0 && plan.add.length === 0 && (
            <p className="text-muted">The deck is at its land target.</p>
          )}
          {plan.considerBuying.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-muted text-xs font-medium uppercase">Lands to consider buying</h3>
              <LandList lands={plan.considerBuying} prices />
              <Link
                href={`/singles/list?list=${encodeURIComponent(
                  plan.considerBuying.map((land) => `1 ${land.card.name}`).join("\n"),
                )}`}
                className="self-start text-xs underline underline-offset-2"
              >
                Look at these in the singles store
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function LandList(props: { lands: readonly PlannedLand[]; prices?: boolean }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {props.lands.map((land) => (
        <li key={land.card.oracleId}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">
              {land.quantity > 1 ? `${land.quantity} ` : ""}
              {land.card.name}
            </span>
            {land.tapped !== "never" && (
              <span className="rounded bg-zinc-100 px-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {land.tapped === "always" ? "enters tapped" : "sometimes tapped"}
              </span>
            )}
            {props.prices === true && land.card.priceCents !== null && (
              <span className="text-muted text-xs">
                {Cents.format(Cents.of(land.card.priceCents))}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {[
              ...land.reasons.map(landReasonText),
              ...(land.card.alsoIn.length > 0 ? [`also in ${land.card.alsoIn.join(", ")}`] : []),
            ].join(" · ")}
          </p>
        </li>
      ))}
    </ul>
  );
}
