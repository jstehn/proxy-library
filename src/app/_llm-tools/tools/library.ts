import { z } from "zod";
import {
  enabledSets,
  priceHistory,
  printingCards,
  printingDetail,
  searchPrintings,
} from "@/modules/catalog";
import { collectionPage, ownedByOracle, ownedCopies } from "@/modules/collection";
import { realOwnedByOracle } from "@/modules/real-collection";
import {
  budgetList,
  budgetReplacements,
  cardsToGetFor,
  deckCombosView,
  decksFor,
  decksUsing,
  deckSuggestions,
  findCard,
  semanticSearchForDeck,
  similarCards,
  type Suggestion,
} from "@/modules/decks";
import { currentEconomySettings, nextPayday } from "@/modules/wallet";
import { wishesForCard, wishlistAnswers } from "@/modules/wishlist";
import { reasonText } from "@/app/decks/labels";
import {
  cardNotFound,
  deckNotFound,
  defineTool,
  done,
  money,
  moneyOrNull,
  type ToolContext,
} from "../tool";

// Your account, cards and the app's own recommendations (design doc 28, section 5.2).

const deckId = z.number().int().positive().describe("The deck's id, from list_decks.");

export const getAccount = defineTool({
  name: "get_account",
  title: "My account",
  description: [
    "Who you are and what you have: your balance (play money for the store), allowance if any, and how many cards, decks and wishes you have.",
    "Use it when: starting a conversation, or before suggesting purchases (to stay within the balance).",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({}),
  async run(context) {
    const { db, clock, wallet } = context.container;
    const userId = context.actor.userId;
    const [balance, settings, collection, decks, wishes] = await Promise.all([
      // Brings the wallet up to date (a due allowance is paid), as every page that shows money does.
      wallet.refreshWallet(userId),
      currentEconomySettings(db),
      collectionPage(db, userId, { sections: "none", sort: "name", page: 1 }),
      decksFor(db, userId),
      wishlistAnswers(db, userId),
    ]);
    const allowancesOn = settings.allowance > 0;
    return done({
      player: { username: context.actor.username, displayName: context.actor.displayName },
      scopes: context.scopes,
      balance: money(balance),
      allowance: allowancesOn
        ? {
            amount: money(settings.allowance),
            everyDays: settings.allowancePeriodDays,
            next: nextPayday(
              { anchor: settings.allowanceAnchor, periodDays: settings.allowancePeriodDays },
              clock.now(),
            ).toISOString(),
          }
        : null,
      collection: {
        differentCards: collection.totals.different,
        copies: collection.totals.copies,
        value: money(collection.totals.valueCents),
      },
      decks: decks.length,
      wishes: wishes.wishes.length,
    });
  },
});

export const getCard = defineTool({
  name: "get_card",
  title: "Get a card",
  description: [
    "One card in full: rules text of every face, type, mana cost, its printings for sale in the store with prices, how its price has moved, how many you own (across all printings, split into game and real copies — matching get_deck when usesRealCards is on), which of your decks use it, and your wishes for it.",
    "Use it when: checking a card before recommending it, finding a printing id (for choose_printing or add_wish), or answering a question about one card.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    card: z.string().min(1).describe("The card's exact English name, or a printing or oracle id."),
  }),
  async run(context, input) {
    const { db } = context.container;
    const userId = context.actor.userId;
    const found = await findCard(db, input.card);
    if (found === null) return cardNotFound(input.card);
    const [detail, history, owned, gameCopies, realCopies, using, wishes, printings] =
      await Promise.all([
        printingDetail(db, found.printingId),
        priceHistory(db, found.printingId),
        ownedCopies(db, userId, found.printingId),
        ownedByOracle(db, userId, found.oracleId),
        realOwnedByOracle(db, userId, found.oracleId),
        decksUsing(db, userId, [found.printingId]),
        wishesForCard(db, userId, found.printingId),
        searchPrintings(db, {
          userId,
          search: `!"${found.name.replace(/"/g, "")}"`,
          sort: "price",
          page: 1,
        }),
      ]);
    const gameTotal = gameCopies.reduce((sum, copy) => sum + copy.quantity, 0);
    const realTotal = realCopies.reduce((sum, copy) => sum + copy.quantity, 0);
    const printingList = await printingsFor(context, printings.printingIds.slice(0, 20));
    return done({
      name: found.name,
      oracleId: found.oracleId,
      printingId: found.printingId,
      typeLine: found.typeLine,
      manaCost: found.manaCost,
      colorIdentity: found.colorIdentity,
      faces: detail?.card.faces ?? [],
      set: detail === null ? null : { code: detail.setCode, name: detail.setName },
      priceTrend: Object.entries(history).map(([finish, points]) => ({
        finish,
        first: points[0] === undefined ? null : { day: points[0].day, ...money(points[0].price) },
        latest:
          points.length === 0
            ? null
            : { day: points[points.length - 1].day, ...money(points[points.length - 1].price) },
        low: points.length === 0 ? null : money(Math.min(...points.map((point) => point.price))),
        high: points.length === 0 ? null : money(Math.max(...points.map((point) => point.price))),
      })),
      owned: {
        total: gameTotal + realTotal,
        game: gameTotal,
        real: realTotal,
        printings: [
          ...gameCopies.map((copy) => ({ ...copy, source: "game" as const })),
          ...realCopies.map((copy) => ({ ...copy, source: "real" as const })),
        ],
      },
      ownedOfThisPrinting: owned,
      decksUsing: using.get(found.printingId) ?? [],
      wishes: wishes.map((wish) => ({ wishId: wish.id, quantity: wish.quantity })),
      printingsForSale: printingList,
    });
  },
});

async function printingsFor(context: ToolContext, ids: readonly string[]) {
  const cards = await printingCards(context.container.db, ids);
  return ids.flatMap((id) => {
    const card = cards.get(id);
    if (card === undefined) return [];
    return [
      {
        printingId: id,
        set: card.setCode,
        number: card.collectorNumber,
        variant: card.variantLabel,
        prices: Object.fromEntries(
          Object.entries(card.prices).map(([finish, cents]) => [finish, money(cents)]),
        ),
      },
    ];
  });
}

export const listSets = defineTool({
  name: "list_sets",
  title: "List the sets in the store",
  description:
    "The sets whose cards the store sells and the searches cover, newest first, with their codes (for s:CODE in a search).",
  scope: "read",
  readOnly: true,
  input: z.object({}),
  async run(context) {
    const sets = await enabledSets(context.container.db);
    return done({
      sets: sets.map((set) => ({
        code: set.code,
        name: set.name,
        released: set.releaseDate,
        printings: set.printingCount,
      })),
    });
  },
});

function suggestionView(suggestion: Suggestion, includeText: boolean) {
  const card = suggestion.card;
  return {
    name: card.name,
    oracleId: card.oracleId,
    printingId: card.printingId,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    ...(includeText ? { text: card.text } : {}),
    ...(card.isGameChanger ? { isGameChanger: true } : {}),
    owned: card.owned,
    price: moneyOrNull(card.priceCents),
    rating: suggestion.rating,
    ratingParts: suggestion.ratingParts.map((part) => ({
      kind: part.kind,
      label: part.label,
      contribution: Math.round(part.contribution * 100) / 100,
    })),
    why: suggestion.reasons.map(reasonText),
  };
}

const includeText = z
  .boolean()
  .default(false)
  .describe("Include each card's rules text (off by default to save space).");

export const suggestForDeck = defineTool({
  name: "suggest_for_deck",
  title: "The app's suggestions for a deck",
  description: [
    "The app's own suggestions for a deck: its profile (themes, creature types and keywords it read from the commander and deck, and roles below target), then cards for the deck and for each short role, from your collection first and then the store, each with why.",
    "Use it when: you want a second opinion next to your own search_for_deck queries, or quick picks for missing roles (ramp, draw, removal, wipe). These are ideas to consider, not a ranking of the best cards: its themes come from fixed rules, so it can miss what a deck is really about; analyze_cards and search_for_deck can find more.",
    "With a target bracket on the deck, cards that would take it over are left out; hiddenOverTarget says how many.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({ deckId, includeText }),
  async run(context, input) {
    const result = await deckSuggestions(context.container.db, context.actor.userId, input.deckId);
    if (result === null) return deckNotFound(input.deckId);
    return done({
      profile: result.profile,
      forDeck: {
        owned: result.forDeck.owned.map((each) => suggestionView(each, input.includeText)),
        store: result.forDeck.store.map((each) => suggestionView(each, input.includeText)),
        hiddenOverTarget: result.forDeck.hiddenOverTarget,
      },
      forRoles: result.forRoles.map((role) => ({
        role: role.tag,
        count: role.count,
        target: role.target,
        owned: role.owned.map((each) => suggestionView(each, input.includeText)),
        store: role.store.map((each) => suggestionView(each, input.includeText)),
        hiddenOverTarget: role.hiddenOverTarget,
      })),
    });
  },
});

export const similarCardsTool = defineTool({
  name: "similar_cards",
  title: "Cards like this one",
  description: [
    "Cards that do what one card does (same roles, themes, keywords, types), for a deck: within its colors and format, yours first.",
    "Use it when: replacing a card, or finding more copies of an effect.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    card: z.string().min(1).describe("The card to match: its exact name or id."),
    includeText,
  }),
  async run(context, input) {
    const found = await findCard(context.container.db, input.card);
    if (found === null) return cardNotFound(input.card);
    const result = await similarCards(
      context.container.db,
      context.actor.userId,
      input.deckId,
      found.oracleId,
    );
    if (result === null) return deckNotFound(input.deckId);
    return done({
      like: found.name,
      owned: result.owned.map((each) => suggestionView(each, input.includeText)),
      store: result.store.map((each) => suggestionView(each, input.includeText)),
      hiddenOverTarget: result.hiddenOverTarget,
    });
  },
});

export const budgetUpgrades = defineTool({
  name: "budget_upgrades",
  title: "Upgrade ideas within a budget",
  description: [
    "Store cards a deck could buy within a budget, picked greedily by how well they fit the app's simple rules, as a list Buy a list accepts. Ideas to consider, not the best possible upgrades.",
    "Use it when: the player asks what to buy for a deck for $N. Nothing is bought: the player buys in the web app, or you add the picks to the wishlist with add_wish.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    budgetCents: z.number().int().min(1).describe("The budget in cents (2000 is $20)."),
    includeText,
  }),
  async run(context, input) {
    const result = await budgetList(
      context.container.db,
      context.actor.userId,
      input.deckId,
      input.budgetCents,
    );
    if (result === null) return deckNotFound(input.deckId);
    return done({
      picks: result.picks.map((each) => suggestionView(each, input.includeText)),
      total: money(result.totalCents),
      list: result.listText,
      hiddenOverTarget: result.hiddenOverTarget,
    });
  },
});

export const budgetReplacementsTool = defineTool({
  name: "budget_replacements",
  title: "Budget replacements for expensive cards",
  description: [
    "Finds cheaper legal cards with similar rules text (via card embeddings) and deck fit for expensive cards in a deck.",
    "Use it when: the player wants budget alternatives for a specific expensive card or the priciest cards in their deck.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    card: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional card name or id to replace; omit to scan the deck's priciest non-land cards.",
      ),
    minPriceCents: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Minimum card price in cents to consider expensive when scanning (default 500 = $5).",
      ),
    maxPriceCents: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum replacement price in cents (default 200 = $2)."),
    includeText,
  }),
  async run(context, input) {
    let oracleId: string | undefined;
    if (input.card !== undefined) {
      const found = await findCard(context.container.db, input.card);
      if (found === null) return cardNotFound(input.card);
      oracleId = found.oracleId;
    }
    const result = await budgetReplacements(
      context.container.db,
      context.actor.userId,
      input.deckId,
      {
        oracleId,
        minPriceCents: input.minPriceCents,
        maxPriceCents: input.maxPriceCents,
      },
    );
    if (result === null) return deckNotFound(input.deckId);
    return done({
      minPrice: money(result.minPriceCents),
      maxPrice: money(result.maxPriceCents),
      cards: result.cards.map((entry) => ({
        target: {
          name: entry.target.name,
          oracleId: entry.target.oracleId,
          typeLine: entry.target.typeLine,
          price: money(entry.target.priceCents),
        },
        owned: entry.owned.map((pick) => ({
          name: pick.card.name,
          oracleId: pick.card.oracleId,
          price: moneyOrNull(pick.card.priceCents),
          saved: money(pick.savedCents),
          similarityPct: pick.similarityPct,
          rating: pick.rating,
          ...(input.includeText ? { text: pick.card.text } : {}),
        })),
        store: entry.store.map((pick) => ({
          name: pick.card.name,
          oracleId: pick.card.oracleId,
          price: moneyOrNull(pick.card.priceCents),
          saved: money(pick.savedCents),
          similarityPct: pick.similarityPct,
          rating: pick.rating,
          ...(input.includeText ? { text: pick.card.text } : {}),
        })),
      })),
    });
  },
});

export const semanticSearchForDeckTool = defineTool({
  name: "semantic_search_for_deck",
  title: "Semantic concept search for a deck",
  description: [
    "Finds legal cards in a deck's color identity matching a natural-language effect description (via card embeddings), optionally fused with a keyword filter.",
    "Use it when: searching for an effect or mechanic by concept rather than exact MTG wording (e.g. 'free sacrifice outlets that draw cards').",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    concept: z
      .string()
      .min(2)
      .describe("Natural-language description of the effect or role you want."),
    filter: z
      .string()
      .min(1)
      .optional()
      .describe("Optional substring filter on name, type line, or rules text (fused via RRF)."),
    types: z
      .array(z.string().min(1))
      .max(10)
      .optional()
      .describe(
        "Optional card types to include (OR-matched on type line before ranking, e.g. ['creature', 'artifact', 'enchantment', 'planeswalker', 'land']).",
      ),
    excludeTypes: z
      .array(z.string().min(1))
      .max(10)
      .optional()
      .describe("Optional card types to exclude before ranking (e.g. ['instant', 'sorcery'])."),
    maxPriceCents: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Optional maximum card price in cents."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe("Maximum results per pool (default 10, max 25)."),
    includeText,
  }),
  async run(context, input) {
    const result = await semanticSearchForDeck(
      context.container.db,
      context.container.textEmbedder,
      context.actor.userId,
      input.deckId,
      {
        concept: input.concept,
        filter: input.filter,
        types: input.types,
        excludeTypes: input.excludeTypes,
        maxPriceCents: input.maxPriceCents,
        limit: input.limit,
      },
    );
    if (result === null) return deckNotFound(input.deckId);
    const mapPick = (pick: (typeof result.owned)[number]) => ({
      name: pick.card.name,
      oracleId: pick.card.oracleId,
      typeLine: pick.card.typeLine,
      manaCost: pick.card.manaCost,
      price: moneyOrNull(pick.card.priceCents),
      similarityPct: pick.similarityPct,
      rating: pick.rating,
      ...(input.includeText ? { text: pick.card.text } : {}),
    });
    return done({
      concept: result.concept,
      owned: result.owned.map(mapPick),
      store: result.store.map(mapPick),
      hiddenOverTarget: result.hiddenOverTarget,
    });
  },
});

export const findCombosForDeckTool = defineTool({
  name: "find_combos_for_deck",
  title: "Find combos and 1-card-away partners",
  description: [
    "Lists Commander Spellbook two-card combos already complete in the deck, plus cards you own or can buy that complete a two-card combo with something in the deck (respecting targetBracket).",
    "Use it when: checking what combos a deck already runs or looking for combo finishers.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Maximum 1-card-away partners per pool (default 15, max 30)."),
    includeText,
  }),
  async run(context, input) {
    const result = await deckCombosView(
      context.container.db,
      context.actor.userId,
      input.deckId,
      input.limit,
    );
    if (result === null) return deckNotFound(input.deckId);
    const mapPartner = (entry: (typeof result.oneCardAway.owned)[number]) => ({
      name: entry.card.name,
      oracleId: entry.card.oracleId,
      price: moneyOrNull(entry.card.priceCents),
      partnersWith: entry.partnersWith,
      ...(input.includeText ? { text: entry.card.text } : {}),
    });
    return done({
      complete: result.complete,
      oneCardAway: {
        owned: result.oneCardAway.owned.map(mapPartner),
        store: result.oneCardAway.store.map(mapPartner),
        hiddenOverTarget: result.oneCardAway.hiddenOverTarget,
      },
    });
  },
});

export const cardsToGet = defineTool({
  name: "cards_to_get",
  title: "Cards my decks still need",
  description:
    "Every card your decks use that you don't own enough of, with which decks need it, the cheapest price in the store, and the total. Use it when: planning purchases across all decks.",
  scope: "read",
  readOnly: true,
  input: z.object({}),
  async run(context) {
    const result = await cardsToGetFor(context.container.db, context.actor.userId);
    return done({
      cards: result.cards.map((card) => ({
        name: card.name,
        oracleId: card.oracleId,
        missing: card.missing,
        owned: card.owned,
        decks: card.decks,
        price: moneyOrNull(card.priceCents),
      })),
      total: money(result.totalCents),
      list: result.listText,
    });
  },
});
