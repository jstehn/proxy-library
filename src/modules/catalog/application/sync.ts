import {
  CARD_FEATURES_VERSION,
  cardTags,
  cardThemes,
  textBracketFlags,
} from "@/shared/card-search";
import { ok } from "@/shared/kernel";
import {
  isNightlySyncDue,
  priceSnapshots,
  snapshotDay,
  standardSetsFromTally,
  supportingSetCodes,
  tallyStandard,
  withoutBrokenReferences,
  type StandardTally,
  companionsToEnable,
  isEnabledByDefault,
  isStillSettling,
  REFERENCE_SETS_PER_RUN,
  referenceSetsToImport,
} from "../domain/rules";
import type { PriceSnapshot, SetCode, SetImport, TokenPrinting } from "../domain/types";
import { emptyArtworkSummary, makeArtworkPass, type ArtworkSummary } from "./artwork";
import { makeEdhrecSync, type EdhrecSyncSummary } from "./edhrec";
import type {
  CardExtras,
  CatalogDependencies,
  CatalogServices,
  SetState,
  SyncKind,
  SyncRun,
  TokenLink,
} from "./ports";

// The data sync (design doc 04, section 5). It runs in the worker and takes minutes, so it is
// split into many short transactions (one per set, one per batch of prices) rather than one
// long one that would hold locks the whole time.

/** What a sync run did, shown to admins on /admin/catalog. */
export type SyncSummary = {
  kind: SyncKind;
  mtgjsonVersion: string;
  bulkFileUpdatedAt: string;
  bulkFileDownloaded: boolean;
  setsInList: number;
  /** Sets enabled because they were listed for the first time (rule 13). */
  enabledByDefault: string[];
  enabledAsCompanions: string[];
  importedSets: string[];
  importedSupportingSets: string[];
  /** Sets imported printings-only for real collections, a few dozen per run (design doc 16). */
  importedReferenceSets?: string[];
  /** Boosters, products and decks left out because they refer to something missing (rule 5). */
  leftOut: string[];
  /** Sets whose import failed with an unexpected error. The other sets still import. */
  failedSets: { code: string; error: string }[];
  skippedDigital: {
    printings: number;
    boosterTypes: string[];
    products: string[];
    decks: string[];
  };
  pricedPrintings: number;
  /** Token printings stored by the bulk-file pass (design doc 25). */
  tokenPrintings?: number;
  /** Printings whose role tags and themes were worked out (design doc 20). */
  taggedPrintings?: number;
  priceSnapshots: number;
  /** Official product photos, key art, MSRPs and details from WPN (design doc 13). */
  artwork: ArtworkSummary;
  edhrec?: EdhrecSyncSummary;
  durationMs: number;
};

const BATCH_SIZE = 500;

export function makeSync(dependencies: CatalogDependencies) {
  const { unitOfWork, mtgjson, scryfall, clock } = dependencies;

  /** Runs `work` in its own short transaction. For steps that can't fail in an expected way. */
  async function inTransaction<T>(work: (services: CatalogServices) => Promise<T>): Promise<T> {
    const result = await unitOfWork.run<T, never>(async (services) => ok(await work(services)));
    if (!result.ok) throw new Error("unreachable");
    return result.value;
  }

  const artworkPass = makeArtworkPass(dependencies, inTransaction);
  const { syncEdhrec } = makeEdhrecSync(dependencies);

  async function runSync(kind: SyncKind): Promise<SyncSummary> {
    const startedAt = clock.now().getTime();
    const summary: SyncSummary = {
      kind,
      mtgjsonVersion: "",
      bulkFileUpdatedAt: "",
      bulkFileDownloaded: false,
      setsInList: 0,
      enabledByDefault: [],
      enabledAsCompanions: [],
      importedSets: [],
      importedSupportingSets: [],
      importedReferenceSets: [],
      leftOut: [],
      failedSets: [],
      skippedDigital: { printings: 0, boosterTypes: [], products: [], decks: [] },
      pricedPrintings: 0,
      taggedPrintings: 0,
      priceSnapshots: 0,
      artwork: emptyArtworkSummary(),
      durationMs: 0,
    };

    // 1. The list of sets. Online-only sets are never imported (rule 9).
    summary.mtgjsonVersion = await mtgjson.metaVersion();
    const paperSets = (await mtgjson.setList()).filter((entry) => !entry.isOnlineOnly);
    summary.setsInList = paperSets.length;
    // Rule 13: sets listed for the first time are enabled if they're a kind players buy from.
    // Sets already listed keep their switch, so a set an admin turned off stays off.
    summary.enabledByDefault = await inTransaction(async ({ catalog }) => {
      const known = new Set((await catalog.setStates()).map((state) => state.code));
      await catalog.saveSetList(paperSets.map((entry) => entry.set));
      const enabledByDefault = paperSets
        .map((entry) => entry.set)
        .filter((set) => !known.has(set.code) && isEnabledByDefault(set.type))
        .map((set) => set.code);
      await catalog.setEnabled(enabledByDefault, true);
      return enabledByDefault;
    });

    // 2. Scryfall's bulk file, downloaded only if there is a newer one.
    const bulkFile = await scryfall.latestBulkFile();
    summary.bulkFileUpdatedAt = bulkFile.updatedAt.toISOString();
    summary.bulkFileDownloaded = bulkFile.downloaded;

    let states = await inTransaction(({ catalog }) => catalog.setStates());

    // 3. Enabled sets bring their Commander companion sets with them (rule 11: precons).
    const companions = companionsToEnable(states);
    if (companions.length > 0) {
      await inTransaction(({ catalog }) => catalog.setEnabled(companions, true));
      summary.enabledAsCompanions = companions;
      states = await inTransaction(({ catalog }) => catalog.setStates());
    }

    // 4. Import enabled sets that are new (or, on a full run, have a new MTGJSON version).
    const statesByCode = new Map(states.map((state) => [state.code, state]));
    // A prices run imports sets never imported before, and re-imports recent sets whose data
    // MTGJSON is still filling in (rule 12: a new set's booster recipes and precon contents often
    // arrive after release). A full run re-imports every enabled set.
    const now = clock.now();
    const needsImport = (state: SetState) =>
      state.importedVersion === null || kind === "full" || isStillSettling(state.releaseDate, now);
    for (const state of states.filter((s) => s.isEnabled && needsImport(s))) {
      try {
        await importSet(state.code, statesByCode, kind, summary);
      } catch (error) {
        summary.failedSets.push({ code: state.code, error: describeError(error) });
      }
    }

    // 4b. Every other paper set's printings, once, for real collections (design doc 16). After
    // the enabled sets, which may have just claimed some of these as supporting sets.
    const afterImports = await inTransaction(({ catalog }) => catalog.setStates());
    // A nightly run takes a few dozen, so no single night is long; a full run (an admin asked for
    // it) takes every one still waiting.
    const limit = kind === "full" ? Infinity : REFERENCE_SETS_PER_RUN;
    for (const code of referenceSetsToImport(afterImports, limit)) {
      try {
        const setImport = await mtgjson.setFile(code);
        await inTransaction(({ catalog }) =>
          catalog.saveImport(setImport, { kind: "reference", importedAt: clock.now() }),
        );
        summary.importedReferenceSets?.push(code);
      } catch (error) {
        summary.failedSets.push({ code, error: describeError(error) });
      }
    }

    // 5. Today's prices for sold sets and real copies; images and legalities for every printing.
    await pricePass(bulkFile.path, summary);

    // 5b. Role tags and themes for printings that are new or tagged by older rules. After the
    // prices, because ramp reads the mana a card makes (design doc 20, section 8).
    summary.taggedPrintings = await tagPass();

    // 6. Official product photos, key art, MSRPs and details from WPN. Never fails the sync.
    try {
      summary.artwork = await artworkPass(kind, states);
    } catch (error) {
      summary.artwork.unreadable.push({ code: "*", error: describeError(error) });
    }

    // 7. EDHREC community Commander data. Never fails the sync.
    if (dependencies.edhrec) {
      try {
        summary.edhrec = await syncEdhrec();
      } catch {
        // Fail-safe: EDHREC is supplementary.
      }
    }

    summary.durationMs = clock.now().getTime() - startedAt;
    return summary;
  }

  async function importSet(
    code: SetCode,
    statesByCode: Map<SetCode, SetState>,
    kind: SyncKind,
    summary: SyncSummary,
  ): Promise<void> {
    const setImport = await mtgjson.setFile(code);
    addSkipped(summary, setImport);

    // Supporting sets first: their printings must exist before this set's references are checked.
    for (const supportCode of supportingSetCodes(setImport)) {
      const support = statesByCode.get(supportCode);
      if (support === undefined) continue; // not a paper set; the reference check below reports it
      // A reference set that an enabled set now draws from becomes a supporting set.
      const needsPrintings =
        support.printingCount === 0 || kind === "full" || !support.isSupporting;
      if (!needsPrintings || summary.importedSupportingSets.includes(supportCode)) continue;
      const supportImport = await mtgjson.setFile(supportCode);
      await inTransaction(({ catalog }) =>
        catalog.saveImport(supportImport, { kind: "supporting", importedAt: clock.now() }),
      );
      summary.importedSupportingSets.push(supportCode);
    }

    // Rule 5: leave out anything that refers to something we don't have, and report it.
    const checked = await inTransaction(async ({ catalog }) => {
      const known = await catalog.knownReferences(code);
      return withoutBrokenReferences(setImport, {
        hasPrinting: (id) => known.printingIds.has(id),
        hasProduct: (id) => known.productIds.has(id),
        hasBooster: (setCode, boosterType) => known.boosters.has(`${setCode}/${boosterType}`),
        hasDeck: (setCode, deckName) => known.decks.has(`${setCode}/${deckName}`),
      });
    });
    summary.leftOut.push(...checked.leftOut.map((reason) => `${code}: ${reason}`));

    // Rule 3: the whole set in one transaction.
    await inTransaction(({ catalog }) =>
      catalog.saveImport(checked.setImport, { kind: "full", importedAt: clock.now() }),
    );
    summary.importedSets.push(code);
  }

  async function pricePass(bulkFilePath: string, summary: SyncSummary): Promise<void> {
    const printings = await inTransaction(({ catalog }) => catalog.printingsForPricing());
    const extraPriced = new Set<string>(await dependencies.extraPricedPrintings.printingIds());
    const day = snapshotDay(clock.now());
    const tally: StandardTally = new Map();
    let snapshots: PriceSnapshot[] = [];
    let extras: CardExtras[] = [];

    async function flush() {
      const [snapshotBatch, extrasBatch] = [snapshots, extras];
      snapshots = [];
      extras = [];
      await inTransaction(async ({ catalog }) => {
        await catalog.savePriceSnapshots(snapshotBatch);
        await catalog.saveCardExtras(extrasBatch);
      });
    }

    // Tokens and the links to them (design doc 25): a few thousand rows, kept until the end and
    // saved in one go, so links never point at tokens that aren't stored yet.
    const tokens: TokenPrinting[] = [];
    const tokenLinks: TokenLink[] = [];

    for await (const card of scryfall.readBulkFile(bulkFilePath)) {
      tallyStandard(tally, card);
      if (card.token !== null) tokens.push(card.token);
      // Paper cards only (rule 9). Any language: a card is matched by its exact Scryfall id, so
      // a non-English entry only matches a printing that exists only in that language, like the
      // Japanese Mystical Archive cards in Secrets of Strixhaven Collector Boosters (rule 8).
      if (card.isDigital) continue;

      const printing = printings.get(card.scryfallId);
      if (printing === undefined) continue;
      for (const tokenId of card.tokenIds) tokenLinks.push({ printingId: printing.id, tokenId });
      // Snapshots only for sold sets and real copies, so reference sets don't fill the price
      // table every night (design doc 16, section 7); images and legalities for every printing.
      const isPriced = printing.isPriced || extraPriced.has(printing.id);
      const todays = isPriced ? priceSnapshots(printing, card, day) : [];
      snapshots.push(...todays);
      extras.push({
        scryfallId: card.scryfallId,
        images: card.images,
        legalities: card.legalities,
        producedMana: card.producedMana,
        keywords: card.keywords,
        isGameChanger: card.isGameChanger,
        edhrecRank: card.edhrecRank,
      });
      if (isPriced) summary.pricedPrintings++;
      summary.priceSnapshots += todays.length;
      if (extras.length >= BATCH_SIZE) await flush();
    }
    await flush();
    await inTransaction(({ catalog }) => catalog.markStandard(standardSetsFromTally(tally)));
    // No tokens at all means the file didn't have them (an old fixture, a cut-down file): keep
    // the ones we have rather than forget every deck's token art.
    if (tokens.length > 0) {
      await inTransaction(({ catalog }) => catalog.replaceTokens(tokens, tokenLinks));
    }
    summary.tokenPrintings = tokens.length;
  }

  /** Works out and stores every out-of-date printing's features, a batch at a time. */
  async function tagPass(): Promise<number> {
    let tagged = 0;
    for (;;) {
      const batch = await inTransaction(({ catalog }) =>
        catalog.printingsToTag(CARD_FEATURES_VERSION, BATCH_SIZE),
      );
      if (batch.length === 0) return tagged;
      const features = batch.map((printing) => ({
        id: printing.id,
        roleTags: cardTags(printing),
        themeTags: cardThemes(printing),
        bracketFlags: textBracketFlags(printing),
      }));
      await inTransaction(({ catalog }) =>
        catalog.saveCardFeatures(features, CARD_FEATURES_VERSION),
      );
      tagged += batch.length;
    }
  }

  /** The worker's main step: run the oldest queued sync, if any. Returns what happened. */
  async function runNextQueuedSync(): Promise<{
    run: SyncRun;
    status: "succeeded" | "failed";
    summary: SyncSummary | null;
  } | null> {
    const run = await inTransaction(({ syncRuns }) => syncRuns.claimNext(clock.now()));
    if (run === null) return null;

    try {
      const summary = await runSync(run.kind);
      const status = summary.failedSets.length > 0 ? "failed" : "succeeded";
      const error =
        status === "failed"
          ? `${summary.failedSets.length} set(s) failed to import: ${summary.failedSets.map((f) => f.code).join(", ")}`
          : null;
      await inTransaction(({ syncRuns }) =>
        syncRuns.finish(run.id, { status, summary, error, finishedAt: clock.now() }),
      );
      return { run, status, summary };
    } catch (error) {
      await inTransaction(({ syncRuns }) =>
        syncRuns.finish(run.id, {
          status: "failed",
          summary: null,
          error: describeError(error),
          finishedAt: clock.now(),
        }),
      );
      return { run, status: "failed", summary: null };
    }
  }

  /** On worker start: runs a crash left "running" are marked failed. */
  async function recoverInterruptedRuns(): Promise<number> {
    return inTransaction(({ syncRuns }) => syncRuns.failInterrupted(clock.now()));
  }

  /** Queues the nightly prices run when it's due and nothing else is waiting. */
  async function queueNightlyIfDue(): Promise<boolean> {
    return inTransaction(async ({ syncRuns }) => {
      const due = isNightlySyncDue({
        lastRunStartedAt: await syncRuns.lastStartedAt(),
        now: clock.now(),
        syncTime: dependencies.syncTime,
      });
      if (!due || (await syncRuns.hasPending())) return false;
      await syncRuns.queue({ kind: "prices", requestedBy: null, requestedAt: clock.now() });
      return true;
    });
  }

  /** Queues a run started by the system (not an admin), unless one is already waiting. */
  async function queueSync(kind: SyncKind): Promise<boolean> {
    return inTransaction(async ({ syncRuns }) => {
      if (await syncRuns.hasPending()) return false;
      await syncRuns.queue({ kind, requestedBy: null, requestedAt: clock.now() });
      return true;
    });
  }

  return {
    runSync,
    runNextQueuedSync,
    recoverInterruptedRuns,
    queueNightlyIfDue,
    queueSync,
    tagPass,
  };
}

function addSkipped(summary: SyncSummary, setImport: SetImport) {
  const skipped = summary.skippedDigital;
  skipped.printings += setImport.skipped.printings;
  const prefix = (name: string) => `${setImport.set.code}: ${name}`;
  skipped.boosterTypes.push(...setImport.skipped.boosterTypes.map(prefix));
  skipped.products.push(...setImport.skipped.products.map(prefix));
  skipped.decks.push(...setImport.skipped.decks.map(prefix));
}

/** An error's message plus the messages of what caused it (e.g. the database's own reason). */
function describeError(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error && messages.length < 5) {
    // Drizzle's "Failed query" messages include every parameter; keep just the first line.
    messages.push(current.message.split("\n")[0]);
    current = current.cause;
  }
  return messages.length > 0 ? messages.join(" ← caused by: ") : String(error);
}
