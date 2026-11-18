import { z } from "zod";
import {
  enabledSets,
  lookupRules,
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
  checkOwnedCards,
  decksFor,
  decksUsing,
  deckSuggestions,
  deckView,
  findCard,
  isPlayed,
  semanticSearchForDeck,
  similarCards,
  type Suggestion,
  declaredComboFor,
} from "@/modules/decks";
import { currentEconomySettings, nextPayday } from "@/modules/wallet";
import { wishesForCard, wishlistAnswers } from "@/modules/wishlist";
import { reasonText } from "@/app/decks/labels";
import { deckProfileFor, withoutAvoidCards } from "../avoid-cards";
import { findSharedRules, matchRelatedRules } from "../related-rules";
import {
  cardNotFound,
  deckNotFound,
  defineTool,
  done,
  failed,
  heuristicProvenance,
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
  name: "get_cards",
  title: "Get cards",
  description: [
    "Full details for 1 to 25 cards: rules text of every face, type, mana cost, store printings with prices, price trend, owned game & real copies, decks using each, and wishes.",
    "Use it when: checking cards' full rules text, printings, or price history before recommending or adding wishes (add_wishes).",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    cards: z
      .array(z.string().min(1))
      .min(1)
      .max(25)
      .describe("1 to 25 card names, printing ids, or oracle ids."),
    cursor: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Pagination cursor returned as `next` when a previous call was capped."),
  }),
  async run(context, input) {
    const { db } = context.container;
    const userId = context.actor.userId;
    const results = await Promise.all(
      input.cards.map(async (query) => {
        const found = await findCard(db, query);
        if (found === null) return { query, found: false };
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
        return {
          query,
          found: true,
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
            first:
              points[0] === undefined ? null : { day: points[0].day, ...money(points[0].price) },
            latest:
              points.length === 0
                ? null
                : { day: points[points.length - 1].day, ...money(points[points.length - 1].price) },
            low:
              points.length === 0 ? null : money(Math.min(...points.map((point) => point.price))),
            high:
              points.length === 0 ? null : money(Math.max(...points.map((point) => point.price))),
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
        };
      }),
    );
    return done({ cards: results });
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

function searchResultView(suggestion: Suggestion, includeText: boolean) {
  const card = suggestion.card;
  return {
    name: card.name,
    oracleId: card.oracleId,
    printingId: card.printingId,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    ...(includeText ? { text: card.text } : {}),
    roleTags: card.roles,
    themes: card.themes,
    regexReasons: suggestion.reasons.map(reasonText),
    ...(card.isGameChanger ? { isGameChanger: true } : {}),
    owned: card.owned,
    price: moneyOrNull(card.priceCents),
  };
}

function asSearchResults(suggestions: readonly Suggestion[], includeText: boolean) {
  return suggestions
    .map((each) => searchResultView(each, includeText))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const includeText = z
  .boolean()
  .default(false)
  .describe("Include each card's rules text (off by default to save space).");

export const suggestForDeck = defineTool({
  name: "idea_candidates",
  title: "Unranked candidate pools from regex rules",
  description: [
    "Opt-in raw heuristic fallback: returns unranked candidate pools for the deck and for each short role, from your collection first and then the store, sorted alphabetically by name with no scores or verdicts — only the regex tags/reasons that matched.",
    "Use it only when: the player explicitly asks for the app's regex candidate pools. Prefer outside research (EDHREC, Spellbook, guides) and search_for_deck; verify every card against its rules text before suggesting it.",
    "With a target bracket on the deck, cards that would take it over are left out; hiddenOverTarget says how many.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    includeText: z
      .boolean()
      .default(true)
      .describe("Include rules text. Set false to save space; you can't judge fit without it."),
  }),
  async run(context, input) {
    const result = await deckSuggestions(context.container.db, context.actor.userId, input.deckId);
    if (result === null) return deckNotFound(input.deckId);
    return done({
      provenance: heuristicProvenance("regex heuristic", ["card text", "edhrec"]),
      profile: result.profile,
      forDeck: {
        owned: asSearchResults(result.forDeck.owned, input.includeText),
        store: asSearchResults(result.forDeck.store, input.includeText),
        hiddenOverTarget: result.forDeck.hiddenOverTarget,
      },
      forRoles: result.forRoles.map((role) => ({
        role: role.tag,
        count: role.count,
        target: role.target,
        owned: asSearchResults(role.owned, input.includeText),
        store: asSearchResults(role.store, input.includeText),
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
    const profile = await deckProfileFor(context, input.deckId);
    const owned = withoutAvoidCards(result.owned, (each) => each.card.name, profile);
    const store = withoutAvoidCards(result.store, (each) => each.card.name, profile);
    const avoided = [...new Set([...owned.avoided, ...store.avoided])];
    return done({
      like: found.name,
      owned: owned.kept.map((each) => suggestionView(each, input.includeText)),
      store: store.kept.map((each) => suggestionView(each, input.includeText)),
      hiddenOverTarget: result.hiddenOverTarget,
      ...(avoided.length > 0 ? { leftOutAvoid: avoided } : {}),
    });
  },
});

export const budgetUpgrades = defineTool({
  name: "idea_budget_upgrades",
  title: "Unranked upgrade ideas within a budget",
  description: [
    "Store cards a deck could buy within a budget, picked greedily by simple regex rules and sorted alphabetically here with no scores. Raw ideas to verify against card text and outside sources, not recommendations.",
    "Use it when: the player asks for rough store ideas within $N. Nothing is bought: verify against rules text and outside sources, then suggest purchases or add them to the wishlist with add_wish.",
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
      provenance: heuristicProvenance("regex heuristic + greedy price", ["card text", "edhrec"]),
      picks: asSearchResults(result.picks, input.includeText),
      total: money(result.totalCents),
      list: result.listText,
      hiddenOverTarget: result.hiddenOverTarget,
    });
  },
});

export const budgetReplacementsTool = defineTool({
  name: "idea_budget_replacements",
  title: "Cheaper similar-text ideas for expensive cards",
  description: [
    "Finds cheaper legal cards with similar rules text (via card embeddings) and regex deck fit for expensive cards in a deck. Raw ideas to verify against card text and outside sources, not recommendations.",
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
      provenance: heuristicProvenance("embedding similarity + regex heuristic", [
        "card text",
        "edhrec",
      ]),
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
          matchedRoles: pick.matchedRoles,
          ...(input.includeText ? { text: pick.card.text } : {}),
        })),
        store: entry.store.map((pick) => ({
          name: pick.card.name,
          oracleId: pick.card.oracleId,
          price: moneyOrNull(pick.card.priceCents),
          saved: money(pick.savedCents),
          similarityPct: pick.similarityPct,
          rating: pick.rating,
          matchedRoles: pick.matchedRoles,
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
    const profile = await deckProfileFor(context, input.deckId);
    const owned = withoutAvoidCards(result.owned, (pick) => pick.card.name, profile);
    const store = withoutAvoidCards(result.store, (pick) => pick.card.name, profile);
    const avoided = [...new Set([...owned.avoided, ...store.avoided])];
    return done({
      concept: result.concept,
      owned: owned.kept.map(mapPick),
      store: store.kept.map(mapPick),
      hiddenOverTarget: result.hiddenOverTarget,
      ...(avoided.length > 0 ? { leftOutAvoid: avoided } : {}),
    });
  },
});

export const getRulingsTool = defineTool({
  name: "get_rulings",
  title: "Get Scryfall rulings for cards",
  description: [
    "Fetches official Scryfall rulings (with dates) for one or more cards, cached server-side for 24 hours.",
    "Use it when: checking rules interactions (e.g., alternative costs, replacement effects, triggered abilities) before recommending or cutting a card.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    cards: z
      .array(z.string().min(1))
      .min(1)
      .max(25)
      .describe(
        "Card names or ids to fetch Scryfall rulings for (pass a 1-element array for a single card).",
      ),
  }),
  async run(context, input) {
    const results = await Promise.all(
      input.cards.map(async (query) => {
        const found = await findCard(context.container.db, query);
        try {
          const fetched = await context.container.outsideData.fetchScryfallRulings(
            found ? { name: found.name, scryfallId: found.scryfallId } : { name: query },
          );
          if (fetched === null) {
            return { query, found: false, rulings: [] };
          }
          return {
            query,
            found: true,
            name: fetched.name,
            sourceUrl: fetched.sourceUrl,
            fetchedAt: fetched.fetchedAt,
            cached: fetched.cached,
            rulings: fetched.rulings,
            ...(found ? { relatedRules: matchRelatedRules(found.text) } : {}),
          };
        } catch (error) {
          return {
            query,
            found: false,
            error: error instanceof Error ? error.message : "Failed to fetch rulings.",
            rulings: [],
          };
        }
      }),
    );
    return done({ cards: results });
  },
});

export const checkInteractionTool = defineTool({
  name: "check_interaction",
  title: "Check rules & CR overlap between cards",
  description: [
    "Returns each card's Scryfall rulings plus the Comprehensive Rules sections their oracle texts share (e.g. CR 513 end step, CR 118.9 alternative costs, CR 400.7 zone changes). Lookup only, not a verdict.",
    "Use it when: checking how 2+ cards interact (e.g. Bolas's Citadel + blitz, Mortuary + Avacyn) before recommending them.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    cards: z
      .array(z.string().min(1))
      .min(2)
      .max(10)
      .describe("2 to 10 card names or ids to check for rulings and shared CR sections."),
  }),
  async run(context, input) {
    const resolved = await Promise.all(
      input.cards.map(async (query) => {
        const found = await findCard(context.container.db, query);
        const relatedRules = found ? matchRelatedRules(found.text) : [];
        let rulings: unknown[] = [];
        try {
          const fetched = await context.container.outsideData.fetchScryfallRulings(
            found ? { name: found.name, scryfallId: found.scryfallId } : { name: query },
          );
          if (fetched) rulings = [...fetched.rulings];
        } catch {
          // Non-fatal: still return relatedRules even if Scryfall rulings are unreachable.
        }
        return {
          query,
          found: found !== null,
          name: found?.name ?? query,
          relatedRules,
          rulings,
        };
      }),
    );
    const sharedRules = findSharedRules(resolved);
    return done({
      cards: resolved,
      sharedRules,
    });
  },
});

export const checkOwnedTool = defineTool({
  name: "check_owned",
  title: "Batch-check ownership, price, and deck usage",
  description: [
    'Checks up to 100 card names in one call: returns owned game copies, owned real copies, cheapest store price, and which of your decks use each card (or "not in catalog").',
    "Use it when: verifying ownership and prices for a list of cards from outside research (EDHREC, Spellbook, guides).",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    names: z.array(z.string().min(1)).min(1).max(100).describe("Up to 100 card names to check."),
  }),
  async run(context, input) {
    const checked = await checkOwnedCards(context.container.db, context.actor.userId, input.names);
    return done({
      cards: checked.map((entry) =>
        entry.inCatalog
          ? {
              query: entry.query,
              name: entry.name,
              inCatalog: true,
              ownedGame: entry.ownedGame,
              ownedReal: entry.ownedReal,
              ownedTotal: entry.ownedTotal,
              cheapestPrice: moneyOrNull(entry.cheapestPriceCents),
              decks: entry.decks,
            }
          : entry,
      ),
    });
  },
});

const SPELLBOOK_BRACKET_LEGEND = {
  E: "Exhibition (casual / low power)",
  P: "Precon / Core",
  O: "Optimized / Upgraded",
  S: "Strong / High Power",
  R: "Ruthless / Fringe cEDH",
  C: "cEDH",
} as const;

export const findCombosForDeckTool = defineTool({
  name: "find_combos",
  title: "Find N-card combos via Commander Spellbook",
  description: [
    "Queries Commander Spellbook's find-my-combos API (including N-card and commander combos, cached 24 hours) for combos in the deck (distinguishing main-deck `complete` vs `needsMaybe`) and combos 1 card away (`oneAway`).",
    "Use it when: checking what combos a deck runs for bracket disclosure, or finding combo lines and missing pieces.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    includeMaybe: z
      .boolean()
      .default(false)
      .describe("Include cards on the maybeboard when checking for combos."),
    bracket: z
      .enum(["E", "P", "O", "S", "R", "C"])
      .optional()
      .describe("Optional Spellbook bracket letter filter (E, P, O, S, R, C)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Max combos to return per status list (default 20, max 100)."),
    offset: z.number().int().min(0).default(0).describe("Pagination offset into the combo lists."),
  }),
  async run(context, input) {
    const view = await deckView(context.container.db, context.actor.userId, input.deckId);
    if (view === null) return deckNotFound(input.deckId);

    const commanders = view.lines.filter((l) => l.board === "commander").map((l) => l.name);
    const mainSet = new Set(
      view.lines
        .filter((l) => l.board === "commander" || isPlayed(l.board))
        .map((l) => l.name.toLowerCase()),
    );
    const maybeSet = new Set(
      view.lines.filter((l) => l.board === "maybe").map((l) => l.name.toLowerCase()),
    );
    const mainCards = view.lines
      .filter(
        (l) =>
          l.board !== "commander" &&
          (isPlayed(l.board) || (input.includeMaybe && l.board === "maybe")),
      )
      .map((l) => l.name);

    let spellbook;
    try {
      spellbook = await context.container.outsideData.fetchSpellbookCombos(mainCards, commanders);
    } catch (error) {
      return failed(
        "SpellbookUnavailable",
        `Could not reach Commander Spellbook: ${error instanceof Error ? error.message : "unknown error"}.`,
      );
    }

    const bracketFilter = input.bracket?.toUpperCase();
    const matchesBracket = (tag: string | null | undefined) =>
      !bracketFilter || (tag ?? "").toUpperCase() === bracketFilter;

    const declaredCombos = (await deckProfileFor(context, input.deckId))?.declaredCombos ?? [];
    const classifiedComplete = spellbook.complete
      .filter((c) => matchesBracket(c.bracketTag))
      .map((combo) => {
        const maybePieces = combo.uses.filter(
          (name) => !mainSet.has(name.toLowerCase()) && maybeSet.has(name.toLowerCase()),
        );
        const declared = declaredComboFor(combo, declaredCombos);
        return {
          ...combo,
          status: maybePieces.length > 0 ? ("needsMaybe" as const) : ("complete" as const),
          ...(maybePieces.length > 0 ? { maybePieces } : {}),
          ...(declared !== null ? { declared } : {}),
        };
      });
    const foundDeclarations = new Set(
      classifiedComplete.flatMap((combo) => ("declared" in combo ? [combo.declared] : [])),
    );

    const filteredOneAway = spellbook.oneCardAway.filter((c) => matchesBracket(c.bracketTag));
    const pagedComplete = classifiedComplete.slice(input.offset, input.offset + input.limit);
    const pagedOneAway = filteredOneAway.slice(input.offset, input.offset + input.limit);

    const missingNames = [...new Set(pagedOneAway.map((c) => c.missingCardName))];
    const ownedChecks =
      missingNames.length > 0
        ? await checkOwnedCards(context.container.db, context.actor.userId, missingNames)
        : [];
    const checkByQuery = new Map(ownedChecks.map((c) => [c.query.toLowerCase(), c]));

    const mainCompleteCount = classifiedComplete.filter((c) => c.status === "complete").length;
    const needsMaybeCount = classifiedComplete.filter((c) => c.status === "needsMaybe").length;

    return done({
      sourceUrl: spellbook.sourceUrl,
      fetchedAt: spellbook.fetchedAt,
      cached: spellbook.cached,
      bracketLegend: SPELLBOOK_BRACKET_LEGEND,
      totalComplete: mainCompleteCount,
      totalNeedsMaybe: needsMaybeCount,
      ...(declaredCombos.length > 0
        ? {
            declaredCombos: declaredCombos.map((declared) => ({
              declared,
              foundBySpellbook: foundDeclarations.has(declared),
            })),
            undeclaredComplete: classifiedComplete.filter(
              (combo) => combo.status === "complete" && !("declared" in combo),
            ).length,
          }
        : {}),
      totalOneAway: filteredOneAway.length,
      offset: input.offset,
      limit: input.limit,
      complete: pagedComplete,
      oneCardAway: pagedOneAway.map((combo) => {
        const owned = checkByQuery.get(combo.missingCardName.toLowerCase());
        return {
          id: combo.id,
          status: "oneAway" as const,
          missingPiece:
            owned && owned.inCatalog
              ? {
                  name: owned.name,
                  inCatalog: true,
                  owned: owned.ownedTotal > 0,
                  ownedTotal: owned.ownedTotal,
                  cheapestPrice: moneyOrNull(owned.cheapestPriceCents),
                }
              : {
                  name: combo.missingCardName,
                  inCatalog: false,
                  owned: false,
                  ownedTotal: 0,
                  cheapestPrice: null,
                },
          uses: combo.uses,
          produces: combo.produces,
          steps: combo.steps,
          prerequisites: combo.prerequisites,
          bracketTag: combo.bracketTag,
          manaNeeded: combo.manaNeeded,
          identity: combo.identity,
        };
      }),
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

export const lookupRulesTool = defineTool({
  name: "lookup_rules",
  title: "Look up Magic Comprehensive Rules",
  description: [
    "Searches the official Magic: The Gathering Comprehensive Rules by exact rule number (e.g. '702.19a', '103.5c') or hybrid keyword + semantic search (e.g. 'layers', 'commander tax', 'trample deathtouch').",
    "Returns top-ranked verbatim CR excerpts, NOT an exhaustive rules engine: always follow cross-referenced rule numbers (e.g. 'see rule 613.1') and check card-specific rulings with get_rulings before giving a definitive ruling.",
    "Use it when: verifying an exact rules interaction, timing, or keyword definition.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    query: z
      .string()
      .min(1)
      .max(200)
      .describe("Rule number (e.g. '702.19a') or rules question/keywords."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(8)
      .describe("Maximum number of matching rules to return (1 to 20)."),
  }),
  async run(context, input) {
    const result = await lookupRules(context.container.db, context.container.textEmbedder, {
      query: input.query,
      limit: input.limit,
    });
    return done({
      crVersion: result.crVersion,
      note:
        result.crVersion === null
          ? "Comprehensive Rules have not been synced yet (run `pnpm worker sync-rules`). An empty result does not mean no rule exists."
          : "Top-ranked verbatim CR excerpts (not exhaustive). Follow any cross-referenced rule numbers and check get_rulings for card-specific rulings.",
      hits: result.hits,
    });
  },
});
