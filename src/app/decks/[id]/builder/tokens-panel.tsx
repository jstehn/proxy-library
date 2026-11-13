"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  filterTokenChecklist,
  summarizeTokenChecklist,
  toTokenChecklistItem,
  type TokenChecklistItem,
  type TokenKind,
  type TokenLine,
} from "@/modules/decks/client";
import { tokensAction } from "./actions";

// Token & emblem checklist (design doc 42): surfaces tokens, emblems, and helper cards created
// by the deck's counted cards (main, commander, and sideboard), excluding the maybeboard.

const REFRESH_DELAY_MS = 350;

const KIND_LABELS: Record<TokenKind, string> = {
  token: "Token",
  emblem: "Emblem",
  helper: "Helper",
};

const KIND_BADGE_CLASSES: Record<TokenKind, string> = {
  token: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  emblem: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  helper: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
};

type Props = Readonly<{
  /** Builder mode: fetches live tokens for this deck whenever `deckKey` changes. */
  deckId?: number;
  deckKey?: string;
  /** Read-only / preloaded mode (e.g. SharedDeckView). Skips server fetches. */
  tokens?: readonly TokenLine[];
  showPrintLink?: boolean;
  onClose: () => void;
}>;

export function TokensPanel(props: Props) {
  const { deckId, deckKey, tokens: staticTokens, showPrintLink = false, onClose } = props;
  const [liveTokens, setLiveTokens] = useState<TokenLine[] | null>(null);
  const [loading, setLoading] = useState(staticTokens === undefined);
  const [kindFilter, setKindFilter] = useState<TokenKind | "all">("all");
  const [playedOnly, setPlayedOnly] = useState(false);
  const latest = useRef(0);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    if (staticTokens !== undefined || deckId === undefined) return;
    const request = ++latest.current;
    const delay = hasLoadedOnce.current ? REFRESH_DELAY_MS : 0;
    const timer = setTimeout(() => {
      setLoading(true);
      void tokensAction(deckId).then((result) => {
        if (request !== latest.current) return;
        hasLoadedOnce.current = true;
        setLiveTokens(result);
        setLoading(false);
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [deckId, deckKey, staticTokens]);

  const activeTokens = staticTokens ?? liveTokens;
  const items: TokenChecklistItem[] = (activeTokens ?? []).map(toTokenChecklistItem);
  const summary = activeTokens === null ? null : summarizeTokenChecklist(activeTokens);
  const filtered = filterTokenChecklist(items, {
    kind: kindFilter,
    board: playedOnly ? "played" : "all",
  });

  const kindOptions: Array<{ value: TokenKind | "all"; label: string; count: number }> =
    summary === null
      ? []
      : [
          { value: "all", label: "All", count: summary.total },
          ...(summary.tokens > 0
            ? [{ value: "token" as const, label: "Tokens", count: summary.tokens }]
            : []),
          ...(summary.emblems > 0
            ? [{ value: "emblem" as const, label: "Emblems", count: summary.emblems }]
            : []),
          ...(summary.helpers > 0
            ? [{ value: "helper" as const, label: "Helpers", count: summary.helpers }]
            : []),
        ];

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-medium">Tokens &amp; emblems</h2>
          {summary !== null && summary.total > 0 && (
            <span className="text-muted text-xs tabular-nums">{formatSummaryCounts(summary)}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close tokens and emblems"
          className="text-muted min-h-7 min-w-7 rounded px-1.5 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ✕
        </button>
      </div>

      {activeTokens === null ? (
        <p className="text-muted">{loading ? "Loading tokens…" : "Couldn't load tokens."}</p>
      ) : activeTokens.length === 0 ? (
        <p className="text-muted">
          None of the counted cards in this deck create tokens, emblems, or helper cards.
        </p>
      ) : (
        <>
          {(kindOptions.length > 2 || (summary !== null && summary.sideboardOnly > 0)) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {kindOptions.length > 2 &&
                kindOptions.map((option) => {
                  const active = kindFilter === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setKindFilter(option.value)}
                      className={`min-h-7 rounded-md border px-2 py-0.5 text-xs ${
                        active
                          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                          : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      }`}
                    >
                      {option.label} ({option.count})
                    </button>
                  );
                })}
              {summary !== null && summary.sideboardOnly > 0 && (
                <button
                  type="button"
                  aria-pressed={playedOnly}
                  onClick={() => setPlayedOnly((value) => !value)}
                  className={`min-h-7 rounded-md border px-2 py-0.5 text-xs ${
                    playedOnly
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
                >
                  Hide sideboard-only ({summary.sideboardOnly})
                </button>
              )}
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="text-muted text-xs">No items match the current filters.</p>
          ) : (
            <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
              {filtered.map((item) => (
                <li
                  key={item.oracleId}
                  className="flex items-start gap-2.5 rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- served by our image cache */}
                  <img
                    src={`/api/images/${item.art.id}/small/front`}
                    alt=""
                    loading="lazy"
                    width={146}
                    height={204}
                    className="aspect-[146/204] w-11 shrink-0 rounded-[4.5%] bg-zinc-100 dark:bg-zinc-800"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{item.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_BADGE_CLASSES[item.kind]}`}
                      >
                        {KIND_LABELS[item.kind]}
                      </span>
                      {item.sideboardOnly && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                          Sideboard only
                        </span>
                      )}
                      {!item.includedInProxies && (
                        <span className="text-muted text-[11px]">(unchecked for PDF)</span>
                      )}
                    </div>
                    {item.description !== "" && (
                      <p className="text-zinc-600 dark:text-zinc-400">{item.description}</p>
                    )}
                    {item.text !== "" && (
                      <p className="text-zinc-600 dark:text-zinc-400">{item.text}</p>
                    )}
                    <p className="text-muted">Made by {item.madeBy.join(", ")}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {loading && <p className="text-muted text-xs">Updating checklist…</p>}
        </>
      )}

      {showPrintLink && deckId !== undefined && (
        <p className="text-muted text-xs">
          <Link href={`/decks/${deckId}/print`} className="underline">
            Choose token art &amp; print proxies
          </Link>
        </p>
      )}
    </section>
  );
}

function formatSummaryCounts(summary: ReturnType<typeof summarizeTokenChecklist>): string {
  const parts: string[] = [];
  if (summary.tokens > 0) {
    parts.push(`${summary.tokens} ${summary.tokens === 1 ? "token" : "tokens"}`);
  }
  if (summary.emblems > 0) {
    parts.push(`${summary.emblems} ${summary.emblems === 1 ? "emblem" : "emblems"}`);
  }
  if (summary.helpers > 0) {
    parts.push(`${summary.helpers} ${summary.helpers === 1 ? "helper" : "helpers"}`);
  }
  return parts.join(" · ");
}
