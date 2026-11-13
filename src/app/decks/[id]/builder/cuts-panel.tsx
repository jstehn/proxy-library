"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Bracket,
  Board,
  DeckLine,
  DeckSuggestions,
  Format,
  OptimizeResult,
  Suggestion,
} from "@/modules/decks";
import {
  deckProfile,
  deckSignalProfile,
  deckStats,
  isLand,
  rankCuts,
  rateCard,
  suggestSwaps,
  type SwapCutMeta,
} from "@/modules/decks/client";
import { cardTags, cardThemes } from "@/shared/card-search";
import { cutReasonText, swapReasonText } from "../../labels";
import { optimizeDeckAction, suggestionsAction } from "./actions";

// Possible cuts (design doc 32, section 9) and one-step swaps (design doc 47): the main-deck
// cards that score lowest on simple checks, with the reasons for each and a button to move it to
// the maybeboard, plus top-rated one-step swap pairs.

/** How many cut candidates the panel shows. */
export const CUTS_SHOWN = 10;
export const SWAPS_SHOWN = 5;

export function CutsPanel(props: {
  deckId: number;
  deckKey: string;
  lines: readonly DeckLine[];
  format: Format;
  targetBracket: Bracket | null;
  onMove: (line: DeckLine, to: Board) => void;
  onSwap: (cutOracleId: string, cutName: string, addOracleId: string, addName: string) => void;
  onSelect: (line: DeckLine) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const { deckId, deckKey, lines, format, targetBracket } = props;
  const [suggestions, setSuggestions] = useState<DeckSuggestions | null>(null);
  const [loadingSwaps, setLoadingSwaps] = useState(true);
  const [optimized, setOptimized] = useState<OptimizeResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    const timer = setTimeout(() => {
      setLoadingSwaps(true);
      void suggestionsAction(deckId).then((result) => {
        if (request !== latest.current) return;
        setSuggestions(result);
        setLoadingSwaps(false);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [deckId, deckKey]);

  const cuts = useMemo(
    () => rankCuts(lines, { format, targetBracket }).slice(0, CUTS_SHOWN),
    [lines, format, targetBracket],
  );

  const swaps = useMemo(() => {
    if (suggestions === null || cuts.length === 0) return [];
    const profile = deckProfile(lines, format);
    const stats = deckStats(lines);
    const ratingProfile = {
      format,
      themes: profile.themes,
      tribes: profile.tribes,
      gaps: profile.gaps,
      keywords: profile.keywords,
      signals: profile.signals ?? deckSignalProfile([]),
      averageManaValue: profile.averageManaValue ?? stats.averageManaValue,
      curveCounts: profile.curveCounts ?? new Map(),
    };
    const cutMeta = new Map<string, SwapCutMeta>();
    const existingOracleIds = new Set<string>();
    for (const line of lines) {
      existingOracleIds.add(line.oracleId);
      if (line.board !== "main" || isLand(line.typeLine) || cutMeta.has(line.oracleId)) continue;
      const facts = { typeLine: line.typeLine, text: line.text, producedMana: line.producedMana };
      const r = rateCard(
        {
          oracleId: line.oracleId,
          name: line.name,
          typeLine: line.typeLine,
          manaValue: line.manaValue,
          text: line.text,
          keywords: line.keywords,
          roles: cardTags(facts),
          themes: cardThemes(facts),
          rarity: line.rarity,
          priceCents: line.priceCents,
          isGameChanger: line.isGameChanger,
        },
        ratingProfile,
        { targetBracket },
      );
      cutMeta.set(line.oracleId, {
        manaValue: line.manaValue,
        rating: r.rating,
        isBasicLand: line.typeLine.includes("Basic Land"),
      });
    }
    const owned = new Map<string, Suggestion>();
    for (const s of suggestions.forDeck.owned) {
      if (!owned.has(s.card.oracleId)) owned.set(s.card.oracleId, s);
    }
    for (const role of suggestions.forRoles) {
      for (const s of role.owned) {
        if (!owned.has(s.card.oracleId)) owned.set(s.card.oracleId, s);
      }
    }
    const pool = owned.size > 0 ? Array.from(owned.values()) : suggestions.forDeck.store;
    const candidates = pool.map((s) => ({
      card: {
        oracleId: s.card.oracleId,
        name: s.card.name,
        typeLine: s.card.typeLine,
        manaValue: s.card.manaValue,
        keywords: s.card.keywords,
        roles: s.card.roles,
        themes: s.card.themes,
        rarity: s.card.rarity,
        priceCents: s.card.priceCents,
        pool: s.card.pool,
        edhrecRank: s.card.edhrecRank,
        edhrec: s.card.edhrec,
      },
      score: s.rating,
      reasons: s.reasons,
      rating: { rating: s.rating, logit: 0, parts: s.ratingParts },
    }));
    const neededRoles = new Set(profile.gaps.map((g) => g.tag));
    return suggestSwaps(cuts, cutMeta, candidates, {
      format,
      targetBracket,
      existingOracleIds,
      neededRoles,
      limit: SWAPS_SHOWN,
    });
  }, [suggestions, cuts, lines, format, targetBracket]);

  const lineOf = (oracleId: string) =>
    lines.find((line) => line.oracleId === oracleId && line.board === "main");

  return (
    <section
      aria-label="Possible cuts"
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Possible cuts</h2>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close possible cuts"
          className="text-muted hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ✕
        </button>
      </div>
      <p className="text-muted text-xs">
        Ideas to consider, not rules: the cards that score lowest on a few simple checks (the themes
        the app found, role counts, the curve and your target bracket). The checks read rules text,
        so they miss combos, synergies they have no rule for and how you play the deck. Lands and
        commanders aren&apos;t listed.
      </p>
      {cuts.length === 0 ? (
        <p className="text-muted">No cards to judge yet: add some spells to the main deck.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {cuts.map((cut) => {
            const line = lineOf(cut.oracleId);
            return (
              <li key={cut.oracleId} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => line && props.onSelect(line)}
                    className="text-left font-medium underline-offset-2 hover:underline"
                  >
                    {cut.name}
                  </button>
                  <ul className="text-xs text-zinc-600 dark:text-zinc-400">
                    {cut.reasons.map((reason, index) => (
                      <li key={index}>{cutReasonText(reason)}</li>
                    ))}
                  </ul>
                </div>
                {line !== undefined && (
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={() => props.onMove(line, "maybe")}
                    aria-label={`Move ${cut.name} to the maybeboard`}
                    className="shrink-0 rounded-md border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-700"
                  >
                    To maybeboard
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {cuts.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Swaps
          </h3>
          {loadingSwaps && swaps.length === 0 ? (
            <p className="text-muted text-xs">Looking for one-step swaps…</p>
          ) : swaps.length === 0 ? (
            <p className="text-muted text-xs">No clear one-step upgrades found.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {swaps.map((swap) => (
                <li
                  key={`${swap.cut.oracleId}:${swap.add.card.oracleId}`}
                  className="flex items-start gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      Cut <span className="underline-offset-2">{swap.cut.name}</span> → Add{" "}
                      <span>{swap.add.card.name}</span>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">
                      {swap.reasons.map(swapReasonText).join(" · ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={() =>
                      props.onSwap(
                        swap.cut.oracleId,
                        swap.cut.name,
                        swap.add.card.oracleId,
                        swap.add.card.name,
                      )
                    }
                    aria-label={`Swap ${swap.cut.name} for ${swap.add.card.name}`}
                    className="shrink-0 rounded-md border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-700"
                  >
                    Swap
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {cuts.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Whole-deck optimizer
            </h3>
            <button
              type="button"
              disabled={props.busy || optimizing}
              onClick={() => {
                setOptimizing(true);
                void optimizeDeckAction(deckId, "owned").then((res) => {
                  setOptimized(res);
                  setOptimizing(false);
                });
              }}
              className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-700"
            >
              {optimizing ? "Optimizing…" : "Run optimizer"}
            </button>
          </div>
          {optimized !== null && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Score: {optimized.before.total.toFixed(1)} → {optimized.after.total.toFixed(1)} (
                {optimized.delta >= 0
                  ? `+${optimized.delta.toFixed(1)}`
                  : optimized.delta.toFixed(1)}
                )
              </p>
              {optimized.swaps.length === 0 ? (
                <p className="text-muted text-xs">
                  No multi-card improvements found in owned pool.
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {optimized.swaps.map((swap) => (
                    <li
                      key={`opt:${swap.cut.oracleId}:${swap.add.oracleId}`}
                      className="flex items-start gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          Cut <span>{swap.cut.name}</span> → Add <span>{swap.add.name}</span>
                        </div>
                        <p className="text-xs text-zinc-600 dark:text-zinc-400">
                          Card rating{" "}
                          {swap.netCardRatingGain >= 0
                            ? `+${swap.netCardRatingGain}`
                            : swap.netCardRatingGain}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={props.busy}
                        onClick={() =>
                          props.onSwap(
                            swap.cut.oracleId,
                            swap.cut.name,
                            swap.add.oracleId,
                            swap.add.name,
                          )
                        }
                        aria-label={`Apply optimized swap ${swap.cut.name} for ${swap.add.name}`}
                        className="shrink-0 rounded-md border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-700"
                      >
                        Swap
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
