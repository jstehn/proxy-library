"use client";
import { isBasicLand } from "@/shared/kernel";
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
  isLand,
  rankCuts,
  rateCard,
  suggestSwaps,
  type SwapCutMeta,
} from "@/modules/decks/client";
import { cutReasonText, swapReasonText } from "@/app/decks/labels";
import { suggestionsAction } from "../suggestions/actions";
import { valueOr } from "../answer";
import { optimizeDeckAction } from "./actions";
import { Card } from "@/ui/card";
import { Eyebrow } from "@/ui/eyebrow";
import { Button } from "@/ui/button";

// Possible cuts (design doc 32, section 9) and one-step swaps (design doc 47): the main-deck
// cards that score lowest on simple checks, with the reasons for each and a button to move it to
// the maybeboard, plus top-rated one-step swap pairs.

/** How many cut candidates the panel shows. */
const CUTS_SHOWN = 10;
const SWAPS_SHOWN = 5;

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
        setSuggestions(valueOr(result, null));
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
    const cutMeta = new Map<string, SwapCutMeta>();
    const existingOracleIds = new Set<string>();
    for (const line of lines) {
      existingOracleIds.add(line.oracleId);
      if (line.board !== "main" || isLand(line.typeLine) || cutMeta.has(line.oracleId)) continue;
      const r = rateCard(line, profile, { targetBracket });
      cutMeta.set(line.oracleId, {
        manaValue: line.manaValue,
        rating: r.rating,
        isBasicLand: isBasicLand(line.typeLine),
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
    const neededRoles = new Set(profile.gaps.map((g) => g.tag));
    return suggestSwaps(cuts, cutMeta, pool, {
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
    <Card
      aria-label="Possible cuts"
      as="section"
      padding="md"
      className="flex flex-col gap-2 text-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Possible cuts</h2>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close possible cuts"
          className="text-muted hover:text-foreground"
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
                  <ul className="text-muted text-xs">
                    {cut.reasons.map((reason, index) => (
                      <li key={index}>{cutReasonText(reason)}</li>
                    ))}
                  </ul>
                </div>
                {line !== undefined && (
                  <Button
                    type="button"
                    disabled={props.busy}
                    onClick={() => props.onMove(line, "maybe")}
                    aria-label={`Move ${cut.name} to the maybeboard`}
                    variant="secondary"
                    size="mini"
                    className="shrink-0"
                  >
                    To maybeboard
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {cuts.length > 0 && (
        <div className="border-border-subtle flex flex-col gap-2 border-t pt-3">
          <Eyebrow as="h3">Swaps</Eyebrow>
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
                    <p className="text-muted text-xs">
                      {swap.reasons.map(swapReasonText).join(" · ")}
                    </p>
                  </div>
                  <Button
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
                    variant="secondary"
                    size="mini"
                    className="shrink-0"
                  >
                    Swap
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {cuts.length > 0 && (
        <div className="border-border-subtle flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center justify-between gap-2">
            <Eyebrow as="h3">Whole-deck optimizer</Eyebrow>
            <Button
              type="button"
              disabled={props.busy || optimizing}
              onClick={() => {
                setOptimizing(true);
                void optimizeDeckAction({ deckId, pool: "owned" }).then((res) => {
                  setOptimized(valueOr(res, null));
                  setOptimizing(false);
                });
              }}
              variant="secondary"
              size="mini"
            >
              {optimizing ? "Optimizing…" : "Run optimizer"}
            </Button>
          </div>
          {optimized !== null && (
            <div className="flex flex-col gap-2">
              <p className="text-muted text-xs">
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
                        <p className="text-muted text-xs">
                          Card rating{" "}
                          {swap.netCardRatingGain >= 0
                            ? `+${swap.netCardRatingGain}`
                            : swap.netCardRatingGain}
                        </p>
                      </div>
                      <Button
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
                        variant="secondary"
                        size="mini"
                        className="shrink-0"
                      >
                        Swap
                      </Button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
