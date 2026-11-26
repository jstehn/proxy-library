import { z } from "zod";
import type { CatalogSearch } from "@/modules/catalog";
import type { CatalogSynergySearch, SearchForDeck, SemanticSearchResult } from "@/modules/decks";
import { err, ok } from "@/shared/kernel";
import { defineBinding } from "../binding";
import {
  presentCatalogQueries,
  presentCatalogSearch,
  presentDeckSearch,
  presentSemantic,
  presentSignals,
} from "../present/search-cards";

type Failure =
  | Readonly<{ kind: "InvalidInput" | "NothingToAnalyze"; message: string }>
  | Readonly<{ kind: "DeckNotFound" }>;

type Answer =
  | Readonly<{ mode: "signals"; result: Parameters<typeof presentSignals>[0] }>
  | Readonly<{
      mode: "semantic";
      result: SemanticSearchResult;
      owned: SemanticSearchResult["owned"];
      store: SemanticSearchResult["store"];
      avoided: readonly string[];
    }>
  | Readonly<{
      mode: "deck";
      result: SearchForDeck;
      cards: SearchForDeck["cards"];
      avoided: readonly string[];
    }>
  | Readonly<{ mode: "queries"; result: CatalogSynergySearch }>
  | Readonly<{ mode: "catalog"; result: CatalogSearch }>;

const SHORTHAND_UNITS: Readonly<Record<string, number>> = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

function parseAddedSince(raw: string, now: Date): Date | null {
  const trimmed = raw.trim();
  const shorthand = /^(\d+)\s*([mhdw])$/i.exec(trimmed);
  if (shorthand !== null) {
    const amount = Number(shorthand[1]);
    const unitMilliseconds = SHORTHAND_UNITS[shorthand[2].toLowerCase()];
    if (!Number.isFinite(amount) || amount <= 0 || unitMilliseconds === undefined) return null;
    return new Date(now.getTime() - amount * unitMilliseconds);
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const searchCardsBinding = defineBinding({
  name: "search_cards",
  title: "Search cards (catalog, deck-filtered, semantic, or signals)",
  description:
    "Search cards in the collection or store. Pass `deckId` to auto-filter to deck colors/format/bracket and exclude cards already in the deck. Modes: 'syntax' (default, Scryfall-style `search` or `queries`), 'semantic' (natural-language `query` with optional `deckId`, `where`, and `maxPriceCents`; lists ideas in the search's own order, with no scores, some of them poor fits), or 'signals' (recurring mechanics in owned `search`).",
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional deck id for color/format/bracket filtering."),
    mode: z.enum(["syntax", "semantic", "signals"]).default("syntax").describe("Search mode."),
    search: z
      .string()
      .min(1)
      .max(2000)
      .optional()
      .describe("Scryfall-style search string (for syntax/signals)."),
    queries: z
      .array(
        z.object({
          synergy: z.string().min(1).max(60).describe("Synergy label."),
          search: z.string().min(1).max(2000).describe("Scryfall-style search."),
        }),
      )
      .min(1)
      .max(6)
      .optional()
      .describe("Up to 6 labeled synergy queries in mode='syntax' (works with or without deckId)."),
    query: z
      .string()
      .min(1)
      .max(400)
      .optional()
      .describe("Natural-language query (for mode='semantic')."),
    where: z
      .enum(["owned", "game", "real", "store", "both"])
      .optional()
      .describe("Pool: owned, game, real, store, or both."),
    maxPerQuery: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Max cards per query (default 10)."),
    maxPriceCents: z.number().int().min(0).optional().describe("Max store price in cents."),
    includeText: z
      .boolean()
      .default(false)
      .describe("Include oracle rules text (default false to save tokens)."),
    includePrice: z
      .boolean()
      .default(false)
      .describe("Include store price in cents (default false unless requested)."),
    oneRowPerCard: z
      .boolean()
      .default(true)
      .describe("Store search: cheapest printing per card (true) or all printings (false)."),
    sort: z
      .enum(["price_desc", "added_desc", "mv", "name"])
      .optional()
      .describe(
        "Sort order for syntax searches (deck, queries, or catalog/collection): 'price_desc', 'added_desc' (owned newest first), 'mv' (mana value asc), or 'name'. Omit for default synergy/owned ranking.",
      ),
    addedSince: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe(
        "Filter owned cards acquired since an ISO date (e.g. '2026-11-23') or shorthand ('24h', '7d', '2w').",
      ),
    page: z.number().int().min(1).default(1).describe("Page number for plain syntax search."),
  }),
  async call(capabilities, actor, input) {
    const { userId } = actor;
    if (input.mode === "signals") {
      if (input.deckId !== undefined) {
        const signals = await capabilities.deckSignals({
          userId,
          deckId: input.deckId,
          minimumCards: 3,
        });
        return signals.ok ? ok<Answer>({ mode: "signals", result: signals.value }) : signals;
      }
      if ((input.search ?? "").trim() === "") {
        return err<Failure>({
          kind: "NothingToAnalyze",
          message: "Give a deckId, or a search of your cards to analyze.",
        });
      }
      const signals = await capabilities.searchSignals({
        userId,
        search: input.search ?? "",
        minimumCards: 3,
      });
      return signals.ok ? ok<Answer>({ mode: "signals", result: signals.value }) : signals;
    }

    if (input.mode === "semantic") {
      if (!input.query) {
        return err<Failure>({
          kind: "InvalidInput",
          message: "Semantic search requires `query`.",
        });
      }
      const found = await capabilities.deckSearch.semantic({
        userId,
        deckId: input.deckId,
        concept: input.query,
        where: input.where === "owned" || input.where === "store" ? input.where : "both",
        limit: input.maxPerQuery,
        maxPriceCents: input.maxPriceCents,
      });
      return found.ok ? ok<Answer>({ mode: "semantic", ...found.value }) : found;
    }

    if (input.deckId !== undefined) {
      const queries =
        input.queries ?? (input.search ? [{ synergy: "search", search: input.search }] : undefined);
      if (!queries) {
        return err<Failure>({
          kind: "InvalidInput",
          message: "Provide `search` or `queries` when searching for a deck.",
        });
      }
      const found = await capabilities.deckSearch.searchForDeck({
        userId,
        deckId: input.deckId,
        queries,
        where: input.where === "owned" || input.where === "store" ? input.where : "both",
        perQuery: input.maxPerQuery,
        maxPriceCents: input.maxPriceCents ?? null,
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
      });
      return found.ok ? ok<Answer>({ mode: "deck", ...found.value }) : found;
    }

    if (input.queries !== undefined) {
      const found = await capabilities.deckSearch.searchCatalogQueries({
        userId,
        queries: input.queries,
        where: input.where ?? "both",
        perQuery: input.maxPerQuery,
        maxPriceCents: input.maxPriceCents ?? null,
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
      });
      return found.ok ? ok<Answer>({ mode: "queries", result: found.value }) : found;
    }

    let addedSince: Date | undefined;
    if (input.addedSince !== undefined) {
      if (input.where === "store") {
        return err<Failure>({
          kind: "InvalidInput",
          message: "`addedSince` only applies to owned cards (where: 'owned', 'game', or 'real').",
        });
      }
      const parsed = parseAddedSince(input.addedSince, capabilities.now());
      if (parsed === null) {
        return err<Failure>({
          kind: "InvalidInput",
          message:
            "Invalid `addedSince`. Use an ISO date (e.g. '2026-11-23') or shorthand like '24h' or '7d'.",
        });
      }
      addedSince = parsed;
    }

    if (!input.search && addedSince === undefined && input.sort === undefined) {
      return err<Failure>({
        kind: "InvalidInput",
        message: "Provide `search`, `queries`, `addedSince`, or `sort`.",
      });
    }
    const where =
      input.where === "owned" || input.where === "game" || input.where === "real"
        ? input.where
        : addedSince !== undefined || input.sort === "added_desc"
          ? "owned"
          : "store";
    const result = await capabilities.searchCatalog(actor, {
      search: input.search ?? "",
      where,
      page: input.page,
      pageSize: input.maxPerQuery,
      oneRowPerCard: input.oneRowPerCard,
      ...(input.sort !== undefined ? { sort: input.sort } : {}),
      ...(addedSince !== undefined ? { addedSince } : {}),
    });
    return result.ok ? ok<Answer>({ mode: "catalog", result: result.value }) : result;
  },
  present: (answer, { input }) => {
    const showPrice =
      input.includePrice || input.maxPriceCents !== undefined || input.sort === "price_desc";
    switch (answer.mode) {
      case "signals":
        return presentSignals(answer.result);
      case "semantic":
        return presentSemantic(
          answer.result,
          answer.owned,
          answer.store,
          answer.avoided,
          input.includeText,
        );
      case "deck":
        return presentDeckSearch(answer.result, answer.cards, answer.avoided, {
          includeText: input.includeText,
          showPrice,
        });
      case "queries":
        return presentCatalogQueries(answer.result, {
          includeText: input.includeText,
          showPrice,
        });
      case "catalog":
        return presentCatalogSearch(answer.result, {
          includeText: input.includeText,
          showPrice,
          limit: input.maxPerQuery,
        });
    }
  },
  describeError: (failure, { input }) =>
    failure.kind === "DeckNotFound"
      ? {
          kind: "DeckNotFound",
          message: `Deck ${input.deckId} isn't one of your decks. Call list_decks to see their ids.`,
        }
      : failure,
});
