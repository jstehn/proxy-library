import { z } from "zod";
import type { CatalogSearch } from "@/modules/catalog";
import type { SearchForDeck, SemanticSearchResult } from "@/modules/decks";
import { err, ok } from "@/shared/kernel";
import { defineBinding } from "../binding";
import {
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
  | Readonly<{ mode: "catalog"; result: CatalogSearch }>;

export const searchCardsBinding = defineBinding({
  name: "search_cards",
  title: "Search cards (catalog, deck-filtered, semantic, or signals)",
  description:
    "Search cards in the collection or store. Pass `deckId` to auto-filter to deck colors/format/bracket and exclude cards already in the deck. Modes: 'syntax' (default, Scryfall-style `search` or `queries`), 'semantic' (natural-language `query`), or 'signals' (recurring mechanics in owned `search`).",
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
      .describe("Up to 6 synergy queries when deckId + mode='syntax'."),
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
      if (!input.deckId || !input.query) {
        return err<Failure>({
          kind: "InvalidInput",
          message: "Semantic search requires `deckId` and `query`.",
        });
      }
      const found = await capabilities.deckSearch.semantic({
        userId,
        deckId: input.deckId,
        concept: input.query,
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
      });
      return found.ok ? ok<Answer>({ mode: "deck", ...found.value }) : found;
    }

    if (!input.search) {
      return err<Failure>({
        kind: "InvalidInput",
        message: "Provide `search` (or `deckId` + `queries`).",
      });
    }
    const result = await capabilities.searchCatalog({
      userId,
      search: input.search,
      where:
        input.where === "owned" || input.where === "game" || input.where === "real"
          ? input.where
          : "store",
      page: input.page,
      oneRowPerCard: input.oneRowPerCard,
    });
    return result.ok ? ok<Answer>({ mode: "catalog", result: result.value }) : result;
  },
  present: (answer, { input }) => {
    const showPrice = input.includePrice || input.maxPriceCents !== undefined;
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
      case "catalog":
        return presentCatalogSearch(answer.result, {
          includeText: input.includeText,
          showPrice,
          limit: input.maxPerQuery * 2,
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
