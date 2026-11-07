import { z } from "zod";
import { printingCards, searchPrintings } from "@/modules/catalog";
import { collectionPage } from "@/modules/collection";
import {
  deckSignalCards,
  ownedSignalCards,
  SEARCH_FOR_DECK_LIMITS,
  SEARCH_POOLS,
  searchForDeck,
} from "@/modules/decks";
import { cardSignals, searchHelpText } from "@/shared/card-search";
import { cookbookText } from "../cookbook";
import { deckNotFound, defineTool, done, failed, money, moneyOrNull } from "../tool";

// The search tools (design doc 28, sections 3.3, 3.6 and 3.7): the synergy search for a deck,
// a plain search, the deck analysis that suggests what to search for, and the search guide.

const SYNTAX_SUMMARY =
  'Search syntax (Scryfall-style): words match names; o:/regex/ or o:"phrase" rules text (~ is the card\'s own name); t: type; c: colors; id<= color identity; mv<=3; pow>tou; kw:flying; tag:ramp|draw|removal|wipe|counter|tutor|protection; theme:counters|tokens|sacrifice|graveyard|artifacts|enchantments|lifegain|spells|landfall|equipment; is:commander, is:shockland and other land cycles; usd<2; own>0; or, -, parentheses. Call get_search_guide for everything.';

export const searchForDeckTool = defineTool({
  name: "search_for_deck",
  title: "Search cards for a deck, one query per synergy",
  description: [
    "Runs several card searches for one deck at once, one per synergy you name, and merges the results. Every search is automatically limited to the deck's commander colors and format and leaves out cards already in the deck, so don't add color or legality terms yourself.",
    'Use it when: building or upgrading a deck around a commander or a plan; finding enablers and payoffs; "what do I own that fits"; replacing cards in a role. Don\'t use it for one known card (get_card) or general staples (suggest_for_deck).',
    'How to write the queries: first read the commander\'s text with get_deck, and call analyze_cards to see what the rest of the deck keeps doing (counters, tokens, triggers). List 3 to 8 synergies, splitting each mechanic into enablers (cards that create Treasures, sacrifice artifacts, make tokens) and payoffs (cards that say "whenever …" or "for each …" about it). Write one query per synergy. Use o:/regex/ for rules text, with [^.]* between words to stay inside one sentence: o:/whenever [^.]*artifact[^.]* sacrificed/. Narrow with t:, mv<=3, tag: or theme:. get_search_guide has tested patterns (topic "cookbook").',
    SYNTAX_SUMMARY,
    "Reading the result: cards that matched several synergies are the strongest leads. Read each card's text before recommending it: the searches find candidates, you judge fit. If a query found 0, loosen it; if it was capped, narrow it; then run again. Prefer owned cards (owned > 0); price is what a store card would cost.",
    'Example (Jolene, the Plunder Queen): queries [{"synergy":"Treasure makers","search":"o:/create[^.]*treasure/"}, {"synergy":"Sacrifice outlets","search":"o:/sacrifice (a|an|another) [^.]*artifact/"}, {"synergy":"Cheap ramp","search":"tag:ramp mv<=3"}].',
    "Only cards in this app's catalog are searched (expansion, core and Commander sets), with your real ownership and the store's prices.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId: z.number().int().positive().describe("The deck's id, from list_decks."),
    queries: z
      .array(
        z.object({
          synergy: z
            .string()
            .min(1)
            .max(60)
            .describe('What this query looks for: "Treasure makers".'),
          search: z.string().min(1).max(300).describe("The card search, in the search syntax."),
        }),
      )
      .min(1)
      .max(SEARCH_FOR_DECK_LIMITS.queries)
      .describe(`1 to ${SEARCH_FOR_DECK_LIMITS.queries} searches, one per synergy.`),
    where: z
      .enum(SEARCH_POOLS)
      .default("both")
      .describe('"owned": your cards; "store": cards you don\'t own, for sale; "both".'),
    goal: z.string().max(200).default("").describe("What the deck is going for; echoed back."),
    maxPerQuery: z
      .number()
      .int()
      .min(1)
      .max(SEARCH_FOR_DECK_LIMITS.perQuery)
      .default(20)
      .describe("Cards per query."),
    maxPriceCents: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Leave out store cards above this price, in cents (500 is $5)."),
    includeText: z
      .boolean()
      .default(true)
      .describe("Include rules text. Set false to save space; you can't judge fit without it."),
  }),
  async run(context, input) {
    const result = await searchForDeck(context.container.db, context.actor.userId, {
      deckId: input.deckId,
      queries: input.queries,
      where: input.where,
      perQuery: input.maxPerQuery,
      maxPriceCents: input.maxPriceCents ?? null,
    });
    if (result === null) return deckNotFound(input.deckId);
    return done({
      deck: result.deck,
      goal: input.goal === "" ? null : input.goal,
      queries: result.queries,
      cards: result.cards.map((card) => ({
        name: card.name,
        oracleId: card.oracleId,
        printingId: card.printingId,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        ...(input.includeText ? { text: card.text } : {}),
        roleTags: card.roleTags,
        themes: card.themes,
        owned: card.owned,
        price: moneyOrNull(card.priceCents),
        synergies: card.synergies,
      })),
    });
  },
});

export const searchCards = defineTool({
  name: "search_cards",
  title: "Search cards",
  description: [
    "One card search with no deck rules, in your collection or the store. Paged, 60 cards at a time.",
    "Use it when: looking up cards outside a deck's context, or checking what a search finds. For a deck, use search_for_deck: it applies the deck's colors and legality and merges several searches.",
    SYNTAX_SUMMARY,
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    search: z.string().min(1).max(300).describe("The card search, in the search syntax."),
    where: z
      .enum(["owned", "store"])
      .default("store")
      .describe('"owned": your collection; "store": everything for sale in this app.'),
    page: z.number().int().min(1).default(1).describe("Which page, from 1."),
  }),
  async run(context, input) {
    const { db } = context.container;
    if (input.where === "owned") {
      const result = await collectionPage(db, context.actor.userId, {
        search: input.search,
        sections: "none",
        sort: "name",
        page: input.page,
      });
      const cards = await printingCards(
        db,
        result.rows.map((row) => row.printingId),
      );
      return done({
        notes: result.notes,
        totals: { cards: result.totals.different, copies: result.totals.copies },
        pageCount: result.pageCount,
        cards: result.rows.map((row) => {
          const card = cards.get(row.printingId);
          return {
            name: card?.name ?? "",
            printingId: row.printingId,
            set: card?.setCode,
            finish: row.finish,
            quantity: row.quantity,
            text: card?.faces.map((face) => face.text).join("\n"),
            price: moneyOrNull(row.price),
          };
        }),
      });
    }
    const result = await searchPrintings(db, {
      userId: context.actor.userId,
      search: input.search,
      sort: "name",
      page: input.page,
    });
    const ids = result.printingIds;
    const cards = await printingCards(db, ids);
    return done({
      notes: result.notes,
      total: result.total,
      pageCount: result.pageCount,
      cards: ids.flatMap((id) => {
        const card = cards.get(id);
        if (card === undefined) return [];
        const prices = Object.values(card.prices).filter((price) => price !== undefined);
        return [
          {
            name: card.name,
            printingId: id,
            set: card.setCode,
            number: card.collectorNumber,
            rarity: card.rarity,
            text: card.faces.map((face) => face.text).join("\n"),
            cheapest: prices.length === 0 ? null : money(Math.min(...prices)),
          },
        ];
      }),
    });
  },
});

export const analyzeCards = defineTool({
  name: "analyze_cards",
  title: "What a deck keeps doing",
  description: [
    "Counts the mechanics a group of cards has in common: kinds of counters (spore, +1/+1, oil…), tokens they make (Saproling, Treasure…), creature types, keywords, triggers (dies, enters, landfall…), costs (sacrifice a creature, remove counters…), zones, card types, role tags, themes, and recurring phrases no rule names. Each comes with how many cards show it, examples, and a followUp search that finds more like it.",
    "Use it when: starting on a deck (before search_for_deck), or to see what your collection could build (search instead of deckId). It finds what the commander's own text doesn't say: a deck full of spore counters wants proliferate and counter doublers even if the commander never mentions counters.",
    "Reading the result: look for signals on many cards and ask what rewards them: counters → proliferate and doublers; one kind of token → its payoffs and token doublers; a trigger family → trigger doublers and more enablers; a cost → cards that make the cost cheap. Then turn those ideas into search_for_deck queries, starting from the followUp searches.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("A deck to analyze (its commander and main deck). Give this or search."),
    search: z
      .string()
      .max(300)
      .default("")
      .describe('Or: your cards matching a search, such as "id<=g" for everything green you own.'),
    minimumCards: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(3)
      .describe("A signal must show on at least this many cards."),
  }),
  async run(context, input) {
    const { db } = context.container;
    if (input.deckId !== undefined) {
      const cards = await deckSignalCards(db, context.actor.userId, input.deckId);
      if (cards === null) return deckNotFound(input.deckId);
      return done({
        cardCount: cards.length,
        signals: cardSignals(cards, { minimumCards: input.minimumCards }),
      });
    }
    if (input.search.trim() === "") {
      return failed("NothingToAnalyze", "Give a deckId, or a search of your cards to analyze.");
    }
    const { cards, notes } = await ownedSignalCards(db, context.actor.userId, input.search);
    return done({
      cardCount: cards.length,
      notes,
      signals: cardSignals(cards, { minimumCards: input.minimumCards }),
    });
  },
});

export const getSearchGuide = defineTool({
  name: "get_search_guide",
  title: "Card search syntax and synergy patterns",
  description: [
    'The card search reference (topic "syntax": every keyword, with examples) or tested synergy query patterns for common mechanics (topic "cookbook": treasure, artifacts, sacrifice, tokens, counters, landfall, blink, spells, graveyard, lifegain, equipment, tribal, combat, draw, mana base), as Markdown.',
    "Use it when: writing searches for search_for_deck or search_cards, especially the first time, or when a search returned notes.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    topic: z.enum(["syntax", "cookbook"]).default("syntax").describe("Which guide."),
  }),
  async run(_context, input) {
    return done({ guide: input.topic === "syntax" ? searchHelpText() : cookbookText() });
  },
});
