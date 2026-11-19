import { printingCards } from "@/modules/catalog";
import { withDb, type DbExecutor } from "@/shared/db";
import { ok, type Clock, type UserId } from "@/shared/kernel";
import { makeSwapCards, makeTakeFromDeck } from "./application/deck-builder-moves";
import { makeDeckCombos } from "./application/deck-combos";
import { makeEdhrecResearch } from "./application/deck-edhrec";
import { makeDeckFacts } from "./application/deck-facts";
import { makeDeckManaPlan } from "./application/deck-mana-plan";
import { makeDeckOverview } from "./application/deck-overview";
import { makeDeckPlanEdits } from "./application/deck-plan-edits";
import { makeProxyDeck } from "./application/proxy-deck";
import { makeDeckPreviews } from "./application/deck-previews";
import { makeDeckSearch } from "./application/deck-search";
import { makeDeckSignals, makeSearchSignals } from "./application/deck-signals";
import { makeStartDeck } from "./application/deck-start";
import { makeDrawSample } from "./application/draw-sample";
import { makeFindReplacements } from "./application/find-replacements";
import { makeListDecks } from "./application/list-decks";
import type { Decks } from "./application/make-decks";
import type { PreviewRepository } from "./application/ports";
import { DeckId } from "./domain/deck";
import { auditDeckView } from "./queries/audit";
import { budgetReplacements } from "./queries/budget-replacements";
import { checkOwnedCards, deckSignalCards, findCard, ownedSignalCards } from "./queries/card-facts";
import { combosForDeck } from "./queries/combos";
import { getDeckProfile, updateDeckPrimer, updateDeckProfile } from "./queries/deck-profile";
import {
  decksUsing,
  addDeckSource,
  deckView,
  decksFor,
  listDeckSources,
  otherDecksHolding,
} from "./queries/decks";
import { manaBasePlan } from "./queries/mana-base";
import { browseCollection, type BrowseInput } from "./queries/browse";
import { draftForDeck } from "./queries/draft-deck";
import { optimizeDeckForView, type OptimizeDeckPool } from "./queries/optimize";
import { cardPrintings } from "./queries/printings";
import { compareDeckSnapshot, listDeckSnapshots } from "./queries/snapshots";
import { commanderDetails, commandersICanBuild } from "./queries/commanders";
import { deckChangePreview, deckListPreview } from "./queries/preview";
import { searchForDeck } from "./queries/search-for-deck";
import { semanticSearchForDeck } from "./queries/semantic-search";
import { budgetList, deckSuggestions, similarCards } from "./queries/suggestions";
import { publicDeckScorecard } from "./queries/scorecard";
import {
  cardsToGetFor,
  deckComments,
  deckForViewer,
  publicDeckByToken,
  sharedDecks,
} from "./queries/sharing";
import { deckTokenLines, tokenArtOptions } from "./queries/tokens";
import type { TokenMaker } from "./domain/token-proxies";

// The decks module's capabilities (ADR 0026), built from its use cases and queries. The app's
// composition root (src/server/capabilities.ts) calls this once and spreads the result.

type EdhrecReader = Parameters<typeof makeEdhrecResearch>[0]["fetchCommander"];
type CombosReader = Parameters<typeof makeDeckCombos>[0]["fetchCombos"];

export type DeckWiringDependencies = Readonly<{
  db: DbExecutor;
  clock: Clock;
  textEmbedder: (texts: readonly string[]) => Promise<number[][]>;
  outsideData: Readonly<{
    fetchEdhrecCommander: EdhrecReader;
    fetchSpellbookCombos: CombosReader;
  }>;
  decks: Decks;
  previews: PreviewRepository;
  newPreviewId: () => string;
}>;

export function wireDeckCapabilities(dependencies: DeckWiringDependencies) {
  const { db, clock, textEmbedder, outsideData, decks, previews, newPreviewId } = dependencies;

  // The readers several capabilities share, each written once.
  const readDeck = (userId: UserId, deckId: number) => deckView(db, userId, deckId);
  const readPlan = async (userId: UserId, deckId: number) =>
    (await getDeckProfile(db, userId, deckId))?.profile ?? null;
  const ownedChecks = (userId: UserId, names: readonly string[]) =>
    checkOwnedCards(db, userId, names);

  return {
    listDecks: makeListDecks({ decksFor: (userId) => decksFor(db, userId) }),
    deckOverview: makeDeckOverview({
      deckView: readDeck,
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
      deckView: readDeck,
      changePreview: (userId, deckId, changes) => deckChangePreview(db, userId, deckId, changes),
      profile: readPlan,
      applyChanges: (actor, input) =>
        decks.applyChanges(actor, { ...input, deckId: DeckId.of(input.deckId) }),
    }),
    edhrec: makeEdhrecResearch({
      fetchCommander: outsideData.fetchEdhrecCommander,
      deckView: readDeck,
      profile: readPlan,
      ownedChecks,
    }),
    deckCombos: makeDeckCombos({
      fetchCombos: outsideData.fetchSpellbookCombos,
      deckView: readDeck,
      profile: readPlan,
      ownedChecks,
    }),
    drawSample: makeDrawSample({ deckView: readDeck, profile: readPlan, clock }),
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
    deckEdits: decks,
    proxyDeck: makeProxyDeck({
      deckView: readDeck,
      printingCards: (printingIds) => printingCards(db, printingIds),
      tokenLines: (deckId, makers) => deckTokenLines(db, deckId, makers),
    }),
    swapCards: makeSwapCards({
      deckView: readDeck,
      applyChanges: (actor, input) =>
        decks.applyChanges(actor, { ...input, deckId: DeckId.of(input.deckId) }),
    }),
    takeFromDeck: makeTakeFromDeck({
      deckView: readDeck,
      setEntry: (actor, input) =>
        decks.setEntry(actor, { ...input, deckId: DeckId.of(input.deckId) }),
    }),
    // The builder's reads: each answers one question, as the query already does.
    deckReads: {
      deckView: readDeck,
      decksUsing: withDb(db, decksUsing),
      deckForViewer: withDb(db, deckForViewer),
      comments: withDb(db, deckComments),
      decksFor: withDb(db, decksFor),
      sharedDecks: withDb(db, sharedDecks),
      cardsToGet: withDb(db, cardsToGetFor),
      commanderDetails: withDb(db, commanderDetails),
      commandersICanBuild: withDb(db, commandersICanBuild),
      publicDeck: withDb(db, publicDeckByToken),
      publicScorecard: withDb(db, publicDeckScorecard),
      tokenArtOptions: withDb(db, tokenArtOptions),
      listPreview: withDb(db, deckListPreview),
      tokenLines: (deckId: number, makers: readonly TokenMaker[]) =>
        deckTokenLines(db, deckId, makers),
      browse: (userId: UserId, input: BrowseInput) => browseCollection(db, userId, input),
      printingsOf: (userId: UserId, deckId: number, oracleId: string) =>
        cardPrintings(db, userId, deckId, oracleId),
      otherDecksHolding: (userId: UserId, deckId: number, oracleId: string) =>
        otherDecksHolding(db, userId, deckId, oracleId),
      suggestions: (userId: UserId, deckId: number) => deckSuggestions(db, userId, deckId),
      optimize: async (userId: UserId, deckId: number, pool: OptimizeDeckPool) =>
        (await optimizeDeckForView(db, userId, deckId, { pool }))?.result ?? null,
      draft: (userId: UserId, deckId: number, options: { includeStore?: "fill-gaps" | "none" }) =>
        draftForDeck(db, userId, deckId, options),
      similar: (userId: UserId, deckId: number, oracleId: string) =>
        similarCards(db, userId, deckId, oracleId),
      budgetList: (userId: UserId, deckId: number, budgetCents: number) =>
        budgetList(db, userId, deckId, budgetCents),
      snapshots: (userId: UserId, deckId: number) => listDeckSnapshots(db, userId, deckId),
      compareSnapshots: (
        userId: UserId,
        deckId: number,
        beforeSnapshotId: number,
        afterSnapshotId?: number,
      ) => compareDeckSnapshot(db, userId, deckId, beforeSnapshotId, afterSnapshotId),
    },
    deckFacts: makeDeckFacts({ audit: (view) => auditDeckView(db, view) }),
    deckSignals: makeDeckSignals({
      signalCards: (userId, deckId) => deckSignalCards(db, userId, deckId),
    }),
    deckManaPlan: makeDeckManaPlan({ plan: (userId, deckId) => manaBasePlan(db, userId, deckId) }),
    checkOwnedCards: async (request: { userId: UserId; names: readonly string[] }) =>
      ok(await ownedChecks(request.userId, request.names)),
    replacements: makeFindReplacements({
      findCard: (nameOrId) => findCard(db, nameOrId),
      similar: (userId, deckId, oracleId) => similarCards(db, userId, deckId, oracleId),
      budget: (userId, deckId, options) => budgetReplacements(db, userId, deckId, options),
      profile: readPlan,
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
      profile: readPlan,
    }),
    searchSignals: makeSearchSignals({
      ownedCards: (userId, search) => ownedSignalCards(db, userId, search),
    }),
  };
}
