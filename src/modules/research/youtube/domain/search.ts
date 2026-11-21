import { err, ok, type Result } from "@/shared/kernel";
import type { YouTubeVideoId } from "./video-id";

export const DECK_TECH_SEARCH_KINDS = ["deck_tech", "guide", "gameplay", "any"] as const;
export type DeckTechSearchKind = (typeof DECK_TECH_SEARCH_KINDS)[number];

export const SEARCH_SORT_MODES = ["balanced", "relevance", "views", "recent"] as const;
export type SearchSortMode = (typeof SEARCH_SORT_MODES)[number];

export type YouTubeSearchResult = Readonly<{
  videoId: YouTubeVideoId;
  url: string;
  title: string;
  channel: string;
  durationSec: number | null;
  durationText: string | null;
  publishedText: string | null;
  viewCountText: string | null;
}>;

export type SearchQueryError = Readonly<{
  kind: "InvalidSearchQuery";
  message: string;
}>;

const MTG_CONTEXT_PATTERN =
  /\b(mtg|magic|commander|edh|cedh|deck\s*tech|primer|guide|gameplay|upgrade)\b/i;

const KIND_SUFFIX: Record<Exclude<DeckTechSearchKind, "any">, string> = {
  deck_tech: "MTG Commander deck tech",
  guide: "MTG Commander guide primer",
  gameplay: "MTG Commander gameplay",
};

/**
 * Shapes a user/LLM query for Magic: The Gathering deck-tech discovery unless `kind` is `"any"`
 * or the query already includes MTG/Commander context terms.
 */
export function buildDeckTechQuery(
  rawQuery: string,
  kind: DeckTechSearchKind = "deck_tech",
): Result<string, SearchQueryError> {
  const trimmed = rawQuery.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return err({
      kind: "InvalidSearchQuery",
      message: "Provide a commander name, archetype, or search query.",
    });
  }

  if (kind === "any" || MTG_CONTEXT_PATTERN.test(trimmed)) {
    return ok(trimmed);
  }

  return ok(`${trimmed} ${KIND_SUFFIX[kind]}`);
}

const VIEW_SUFFIX_MULTIPLIER: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
};

/** Parses compact YouTube view strings like `"28K"`, `"1.3M views"`, or `"1,234"`. */
export function parseViewCount(text: string | null): number | null {
  if (!text) return null;
  const match = text.replaceAll(",", "").match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = match[2]?.toLowerCase();
  const mult = suffix ? (VIEW_SUFFIX_MULTIPLIER[suffix] ?? 1) : 1;
  return Math.round(base * mult);
}

/** Parses relative YouTube age strings like `"6mo ago"`, `"2y ago"`, `"3 weeks ago"` into months. */
export function parseAgeMonths(text: string | null): number | null {
  if (!text) return null;
  const match = text
    .toLowerCase()
    .match(/(\d+)\s*(s|sec|second|m|min|minute|h|hr|hour|d|day|w|wk|week|mo|month|y|yr|year)s?\b/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2] ?? "";
  if (unit.startsWith("y")) return value * 12;
  if (unit === "mo" || unit.startsWith("month")) return value;
  if (unit.startsWith("w")) return value / 4.345;
  if (unit.startsWith("d")) return value / 30;
  return 0;
}

/**
 * Balances popularity (`log10(views)`) with recency decay (`1 / (1 + ageMonths / 36)`)
 * so recent popular guides beat stale or low-view uploads while standout classics remain competitive.
 */
function scoreBalancedResult(result: YouTubeSearchResult): number {
  const views = parseViewCount(result.viewCountText) ?? 100;
  const popularity = Math.log10(Math.max(10, views));
  const ageMonths = parseAgeMonths(result.publishedText) ?? 24;
  const recencyWeight = 1 / (1 + Math.max(0, ageMonths) / 36);
  return popularity * recencyWeight;
}

function defaultMinDurationSec(kind: DeckTechSearchKind): number {
  return kind === "deck_tech" || kind === "guide" ? 180 : 0;
}

/**
 * Filters out short/meme clips, deduplicates videos, caps per-channel repetition,
 * and ranks candidates according to `sortBy`.
 */
export function rankAndFilterSearchResults(
  results: readonly YouTubeSearchResult[],
  options: {
    kind: DeckTechSearchKind;
    sortBy: SearchSortMode;
    limit: number;
    minDurationSec?: number;
    maxPerChannel?: number;
  },
): YouTubeSearchResult[] {
  const minDuration = options.minDurationSec ?? defaultMinDurationSec(options.kind);
  const maxPerChannel = options.maxPerChannel ?? 2;

  const seenIds = new Set<string>();
  const filtered = results.filter((r) => {
    if (seenIds.has(r.videoId)) return false;
    seenIds.add(r.videoId);
    if (minDuration > 0 && r.durationSec !== null && r.durationSec < minDuration) {
      return false;
    }
    return true;
  });

  const sorted = [...filtered];
  if (options.sortBy === "balanced") {
    sorted.sort((a, b) => scoreBalancedResult(b) - scoreBalancedResult(a));
  } else if (options.sortBy === "views") {
    sorted.sort(
      (a, b) => (parseViewCount(b.viewCountText) ?? -1) - (parseViewCount(a.viewCountText) ?? -1),
    );
  } else if (options.sortBy === "recent") {
    sorted.sort(
      (a, b) =>
        (parseAgeMonths(a.publishedText) ?? Number.POSITIVE_INFINITY) -
        (parseAgeMonths(b.publishedText) ?? Number.POSITIVE_INFINITY),
    );
  }

  const channelCounts = new Map<string, number>();
  const diversified: YouTubeSearchResult[] = [];
  for (const item of sorted) {
    const channelKey = item.channel.trim().toLowerCase();
    const count = channelCounts.get(channelKey) ?? 0;
    if (count >= maxPerChannel) continue;
    channelCounts.set(channelKey, count + 1);
    diversified.push(item);
    if (diversified.length >= options.limit) break;
  }

  return diversified;
}
