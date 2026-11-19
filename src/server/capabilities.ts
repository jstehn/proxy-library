import { makeGetAccountOverview } from "@/modules/accounts";
import { collectionPage } from "@/modules/collection";
import {
  makeCardLookup,
  makeSearchCatalog,
  searchPrintings,
  priceHistory,
  printingCards,
  printingDetail,
  storePrintingsOfCard,
} from "@/modules/catalog";
import { ownedByOracle, ownedCopies as ownedOfPrinting } from "@/modules/collection";
import { realCollectionPage, realOwnedByOracle } from "@/modules/real-collection";
import {
  auditDeckView,
  checkOwnedCards,
  combosForDeck,
  decksUsing,
  findCard,
  deckSignalCards,
  deckTokenLines,
  deckView,
  decksFor,
  getDeckProfile,
  budgetReplacements,
  listDeckSources,
  makeDeckFacts,
  makeDeckSearch,
  makeSearchSignals,
  ownedSignalCards,
  searchForDeck,
  semanticSearchForDeck,
  makeFindReplacements,
  makeDeckManaPlan,
  makeDeckOverview,
  makeDeckSignals,
  manaBasePlan,
  similarCards,
  makeListDecks,
  makeDeckPreviews,
  makeDeckPlanEdits,
  makeStartDeck,
  updateDeckPrimer,
  updateDeckProfile,
  addDeckSource,
  deckChangePreview,
  DeckId,
  type Decks,
  type PreviewRepository,
} from "@/modules/decks";
import { currentEconomySettings, nextPayday } from "@/modules/wallet";
import {
  makeAddWishes,
  makeRemoveWishes,
  makeWishlistView,
  WishId,
  wishesForCard,
  wishlistAnswers,
  type Wishlist,
} from "@/modules/wishlist";
import type { DbExecutor } from "@/shared/db";
import { ok, type Cents, type Clock, type UserId } from "@/shared/kernel";

// The capabilities (ADR 0026): typed functions that the adapters (server actions, LLM tool
// bindings, routes, worker commands) call. Each is built here from its module's factory, with the
// readers it needs from other modules passed in as ports. A new capability gets one line below.

type CapabilityDependencies = Readonly<{
  db: DbExecutor;
  clock: Clock;
  wallet: Readonly<{ refreshWallet(userId: UserId): Promise<Cents> }>;
  textEmbedder: (texts: readonly string[]) => Promise<number[][]>;
  wishlist: Pick<Wishlist, "addWish" | "removeWish">;
  decks: Pick<
    Decks,
    "applyChanges" | "createDeck" | "updateDeck" | "deleteDeck" | "importList" | "replaceList"
  >;
  previews: PreviewRepository;
  newPreviewId: () => string;
}>;

export function buildCapabilities(dependencies: CapabilityDependencies) {
  const { db, clock, wallet, wishlist, textEmbedder, decks, previews, newPreviewId } = dependencies;

  return {
    listDecks: makeListDecks({
      decksFor: (userId) => decksFor(db, userId),
    }),
    deckOverview: makeDeckOverview({
      deckView: (userId, deckId) => deckView(db, userId, deckId),
      combosFor: (oracleIds) => combosForDeck(db, oracleIds),
      printingCards: (printingIds) => printingCards(db, printingIds),
      tokenLines: (deckId, makers) => deckTokenLines(db, deckId, makers),
      sources: (userId, deckId) => listDeckSources(db, userId, deckId),
      profile: (userId, deckId) => getDeckProfile(db, userId, deckId),
    }),
    deckPreviews: makeDeckPreviews({
      previews,
      clock,
      newPreviewId,
      findCards: async (names) => {
        const found = await Promise.all(
          names.map(async (name) => [name, await findCard(db, name)] as const),
        );
        return new Map(
          found.flatMap(([name, card]) => (card === null ? [] : [[name, card.oracleId]])),
        );
      },
      deckView: (userId, deckId) => deckView(db, userId, deckId),
      changePreview: (userId, deckId, changes) => deckChangePreview(db, userId, deckId, changes),
      profile: async (userId, deckId) =>
        (await getDeckProfile(db, userId, deckId))?.profile ?? null,
      applyChanges: (actor, input) =>
        decks.applyChanges(actor, { ...input, deckId: DeckId.of(input.deckId) }),
    }),
    startDeck: makeStartDeck(decks),
    deckPlanEdits: makeDeckPlanEdits({
      clock,
      updateProfile: (userId, deckId, patch, now) =>
        updateDeckProfile(db, userId, deckId, patch, now),
      updatePrimer: (userId, deckId, input, now) =>
        updateDeckPrimer(db, userId, deckId, input, now),
      addSource: (userId, deckId, source, now) => addDeckSource(db, userId, deckId, source, now),
    }),
    // The deck-changing commands, as the decks module's use cases (each checks its own rules).
    deckEdits: {
      createDeck: decks.createDeck,
      updateDeck: decks.updateDeck,
      deleteDeck: decks.deleteDeck,
      importList: decks.importList,
      replaceList: decks.replaceList,
    },
    deckFacts: makeDeckFacts({ audit: (view) => auditDeckView(db, view) }),
    deckSignals: makeDeckSignals({
      signalCards: (userId, deckId) => deckSignalCards(db, userId, deckId),
    }),
    deckManaPlan: makeDeckManaPlan({ plan: (userId, deckId) => manaBasePlan(db, userId, deckId) }),
    lookUpCards: makeCardLookup({
      find: (query) => findCard(db, query),
      detail: (printingId) => printingDetail(db, printingId),
      history: (printingId) => priceHistory(db, printingId),
      ownedOfPrinting: (userId, printingId) => ownedOfPrinting(db, userId, printingId),
      gameCopies: (userId, oracleId) => ownedByOracle(db, userId, oracleId),
      realCopies: (userId, oracleId) => realOwnedByOracle(db, userId, oracleId),
      decksUsing: async (userId, printingId) =>
        (await decksUsing(db, userId, [printingId])).get(printingId) ?? [],
      wishes: (userId, printingId) => wishesForCard(db, userId, printingId),
      storePrintings: (userId, name) => storePrintingsOfCard(db, userId, name, 20),
    }),
    checkOwnedCards: async (request: { userId: UserId; names: readonly string[] }) =>
      ok(await checkOwnedCards(db, request.userId, request.names)),
    wishlistView: makeWishlistView({
      answers: (userId) => wishlistAnswers(db, userId),
      outlook: async (userId) => {
        const [balance, settings] = await Promise.all([
          wallet.refreshWallet(userId),
          currentEconomySettings(db),
        ]);
        return {
          balance,
          allowance: settings.allowance,
          allowancePeriodDays: settings.allowancePeriodDays,
          nextPayday: nextPayday(
            { anchor: settings.allowanceAnchor, periodDays: settings.allowancePeriodDays },
            clock.now(),
          ),
        };
      },
    }),
    addWishes: makeAddWishes({
      findCard: (nameOrId) => findCard(db, nameOrId),
      addWish: (actor, input) => wishlist.addWish(actor, input),
    }),
    removeWishes: makeRemoveWishes(
      { removeWish: (actor, wishId) => wishlist.removeWish(actor, wishId) },
      (value) => WishId.of(value),
    ),
    replacements: makeFindReplacements({
      findCard: (nameOrId) => findCard(db, nameOrId),
      similar: (userId, deckId, oracleId) => similarCards(db, userId, deckId, oracleId),
      budget: (userId, deckId, options) => budgetReplacements(db, userId, deckId, options),
      profile: async (userId, deckId) =>
        (await getDeckProfile(db, userId, deckId))?.profile ?? null,
    }),
    searchCatalog: makeSearchCatalog({
      collection: (userId, page, search) =>
        collectionPage(db, userId, { search, sections: "none", sort: "name", page }),
      realCollection: (userId, page, search) =>
        realCollectionPage(db, userId, { search, sections: "none", sort: "name", page }),
      store: (userId, search, page, oneRowPerCard) =>
        searchPrintings(db, { userId, search, sort: "name", page, oneRowPerCard }),
      printings: (ids) => printingCards(db, ids),
    }),
    deckSearch: makeDeckSearch({
      searchForDeck: (userId, request) =>
        searchForDeck(db, userId, {
          deckId: request.deckId,
          queries: request.queries,
          where: request.where,
          perQuery: request.perQuery,
          maxPriceCents: request.maxPriceCents,
        }),
      semantic: (userId, deckId, request) =>
        semanticSearchForDeck(db, textEmbedder, userId, deckId, request),
      profile: async (userId, deckId) =>
        (await getDeckProfile(db, userId, deckId))?.profile ?? null,
    }),
    searchSignals: makeSearchSignals({
      ownedCards: (userId, search) => ownedSignalCards(db, userId, search),
    }),
    getAccountOverview: makeGetAccountOverview({
      refreshBalance: (userId) => wallet.refreshWallet(userId),
      allowance: async () => {
        const settings = await currentEconomySettings(db);
        if (settings.allowance <= 0) return null;
        return {
          amountCents: settings.allowance,
          everyDays: settings.allowancePeriodDays,
          next: nextPayday(
            { anchor: settings.allowanceAnchor, periodDays: settings.allowancePeriodDays },
            clock.now(),
          ),
        };
      },
      collectionTotals: async (userId) => {
        const page = await collectionPage(db, userId, { sections: "none", sort: "name", page: 1 });
        return {
          differentCards: page.totals.different,
          copies: page.totals.copies,
          valueCents: page.totals.valueCents,
        };
      },
      deckCount: async (userId) => (await decksFor(db, userId)).length,
      wishCount: async (userId) => (await wishlistAnswers(db, userId)).wishes.length,
    }),
  };
}

export type Capabilities = ReturnType<typeof buildCapabilities>;
