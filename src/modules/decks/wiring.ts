import type { Actor } from "@/modules/accounts";
import { printingCards } from "@/modules/catalog";
import type { DbExecutor } from "@/shared/db";
import { ok, pick, type Clock, type UserId } from "@/shared/kernel";
import { makeSwapCards, makeTakeFromDeck } from "./application/deck-builder-moves";
import { makeDeckCombos } from "./application/deck-combos";
import { makeEdhrecResearch } from "./application/deck-edhrec";
import { makeDeckFacts } from "./application/deck-facts";
import { makeDeckManaPlan } from "./application/deck-mana-plan";
import { makeDeckOverview } from "./application/deck-overview";
import { makeDeckPlanEdits } from "./application/deck-plan-edits";
import { makeProxyDeck } from "@/modules/decks/proxies";
import { makeDeckPreviews } from "./application/deck-previews";
import { makeDeckSearch } from "./application/deck-search";
import { makeDeckSignals, makeSearchSignals } from "@/modules/decks/scoring";
import { makeStartDeck } from "./application/deck-start";
import { makeDrawSample } from "@/modules/decks/play";
import { makeFindReplacements } from "./application/find-replacements";
import { makeListDecks } from "./application/list-decks";
import type { Decks } from "./application/make-decks";
import type { PreviewRepository } from "./application/ports";
import type { makeProxySheets } from "@/modules/decks/proxies";
import type { DeckSharing } from "./application/sharing";
import type { makeTokenChoices } from "@/modules/decks/proxies";
import { DeckId } from "./domain/deck";
import { auditDeckView } from "./queries/audit";
import { budgetReplacements } from "./queries/budget-replacements";
import {
  checkOwnedCards,
  deckSignalCards,
  findCard,
  ownedSignalCards,
} from "@/modules/decks/scoring";
import { withFeatures } from "./queries/card-features";
import { combosForDeck } from "./queries/combos";
import { getDeckProfile, updateDeckPrimer, updateDeckProfile } from "./queries/deck-profile";
import { addDeckSource, deckView, decksFor, listDeckSources } from "./queries/decks";
import { manaBasePlan } from "./queries/mana-base";
import { deckChangePreview } from "./queries/preview";
import { searchForDeck } from "./queries/search-for-deck";
import { semanticSearchForDeck } from "./queries/semantic-search";
import { similarCards } from "./queries/suggestions";
import { deckViewForViewer } from "./queries/sharing";
import { deckTokenLines } from "@/modules/decks/proxies";

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
  deckSharing: DeckSharing;
  chooseToken: ReturnType<typeof makeTokenChoices>;
  proxySheet: ReturnType<typeof makeProxySheets>;
  previews: PreviewRepository;
  newPreviewId: () => string;
}>;

export function wireDeckCapabilities(dependencies: DeckWiringDependencies) {
  const { db, clock, textEmbedder, outsideData, decks, previews, newPreviewId } = dependencies;
  const { deckSharing, chooseToken, proxySheet } = dependencies;

  // The readers several capabilities share, each written once.
  const readDeck = (userId: UserId, deckId: number) => deckView(db, userId, deckId);
  const readPlan = async (userId: UserId, deckId: number) =>
    (await getDeckProfile(db, userId, deckId))?.profile ?? null;
  const ownedChecks = (userId: UserId, names: readonly string[]) =>
    checkOwnedCards(db, userId, names);

  return {
    listDecks: makeListDecks({ decksFor: (userId) => decksFor(db, userId) }),
    deckOverview: makeDeckOverview({
      deckView: (actor, deckId) => deckView(db, actor.userId, deckId),
      viewableDeckView: (actor, deckId) => deckViewForViewer(db, actor.userId, deckId),
      combosFor: (oracleIds) => combosForDeck(db, oracleIds),
      printingCards: (printingIds) => printingCards(db, printingIds),
      tokenLines: (deckId, makers) => deckTokenLines(db, deckId, makers),
      sources: (actor, deckId) => listDeckSources(db, actor.userId, deckId),
      profile: (actor, deckId) => getDeckProfile(db, actor.userId, deckId),
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
    drawSample: makeDrawSample({
      deckView: async (userId, deckId) => {
        const view = await readDeck(userId, deckId);
        return view && { ...view, lines: await withFeatures(db, view.lines) };
      },
      profile: readPlan,
      clock,
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
    // The deck-changing commands the builder and the tools use (each checks its own rules).
    deckEdits: pick(
      decks,
      "createDeck",
      "createDeckFromCards",
      "copyDeck",
      "deleteDeck",
      "updateDeck",
      "addCards",
      "setEntry",
      "setEntryDetails",
      "setEntryNote",
      "setEntryHeading",
      "moveEntry",
      "importList",
      "replaceList",
      "choosePrinting",
      "renameHeading",
      "orderHeadings",
      "saveSnapshot",
      "restoreSnapshot",
      "deleteSnapshot",
    ),
    deckSharing: pick(
      deckSharing,
      "setVisibility",
      "enablePublicLink",
      "rotatePublicLink",
      "revokePublicLink",
      "postComment",
      "deleteComment",
    ),
    chooseToken,
    proxySheet,
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
    deckFacts: makeDeckFacts({ audit: (view) => auditDeckView(db, view) }),
    deckSignals: makeDeckSignals({
      signalCards: (userId, deckId) => deckSignalCards(db, userId, deckId),
    }),
    deckManaPlan: makeDeckManaPlan({ plan: (userId, deckId) => manaBasePlan(db, userId, deckId) }),
    checkOwnedCards: async (actor: Actor, request: { names: readonly string[] }) =>
      ok(await ownedChecks(actor.userId, request.names)),
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
