import { ok } from "@/shared/kernel";
import {
  countsTowardStandard,
  isNightlySyncDue,
  missingReferences,
  priceSnapshots,
  snapshotDay,
  supportingSetCodes,
} from "../domain/rules";
import type { PriceSnapshot, SetCode, SetImport } from "../domain/types";
import type {
  CardExtras,
  CatalogDependencies,
  CatalogServices,
  SetState,
  SyncKind,
  SyncRun,
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
  enabledAsStandard: string[];
  importedSets: string[];
  importedSupportingSets: string[];
  failedSets: { code: string; problems: string[] }[];
  skippedDigital: {
    printings: number;
    boosterTypes: string[];
    products: string[];
    decks: string[];
  };
  pricedPrintings: number;
  priceSnapshots: number;
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

  async function runSync(kind: SyncKind): Promise<SyncSummary> {
    const startedAt = clock.now().getTime();
    const summary: SyncSummary = {
      kind,
      mtgjsonVersion: "",
      bulkFileUpdatedAt: "",
      bulkFileDownloaded: false,
      setsInList: 0,
      enabledAsStandard: [],
      importedSets: [],
      importedSupportingSets: [],
      failedSets: [],
      skippedDigital: { printings: 0, boosterTypes: [], products: [], decks: [] },
      pricedPrintings: 0,
      priceSnapshots: 0,
      durationMs: 0,
    };

    // 1. The list of sets. Online-only sets are never imported (rule 9).
    summary.mtgjsonVersion = await mtgjson.metaVersion();
    const paperSets = (await mtgjson.setList()).filter((entry) => !entry.isOnlineOnly);
    summary.setsInList = paperSets.length;
    await inTransaction(({ catalog }) => catalog.saveSetList(paperSets.map((entry) => entry.set)));

    // 2. Scryfall's bulk file, downloaded only if there is a newer one.
    const bulkFile = await scryfall.latestBulkFile();
    summary.bulkFileUpdatedAt = bulkFile.updatedAt.toISOString();
    summary.bulkFileDownloaded = bulkFile.downloaded;

    // 3. The very first run: enable the current Standard sets.
    let states = await inTransaction(({ catalog }) => catalog.setStates());
    if (!states.some((state) => state.isEnabled)) {
      const known = new Set(states.map((state) => state.code));
      const standard = [...(await findStandardSets(bulkFile.path))].filter((code) =>
        known.has(code),
      );
      await inTransaction(async ({ catalog }) => {
        await catalog.markStandard(standard);
        await catalog.setEnabled(standard, true);
      });
      summary.enabledAsStandard = standard;
      states = await inTransaction(({ catalog }) => catalog.setStates());
    }

    // 4. Import enabled sets that are new (or, on a full run, have a new MTGJSON version).
    const statesByCode = new Map(states.map((state) => [state.code, state]));
    const needsImport = (state: SetState) =>
      state.importedVersion === null ||
      (kind === "full" && state.importedVersion !== summary.mtgjsonVersion);
    for (const state of states.filter((s) => s.isEnabled && needsImport(s))) {
      await importSet(state.code, statesByCode, kind, summary);
    }

    // 5. Today's prices, images and legalities for every printing we hold.
    await pricePass(bulkFile.path, summary);

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
      const needsPrintings = support.printingCount === 0 || kind === "full";
      if (!needsPrintings || summary.importedSupportingSets.includes(supportCode)) continue;
      const supportImport = await mtgjson.setFile(supportCode);
      await inTransaction(({ catalog }) =>
        catalog.saveImport(supportImport, { printingsOnly: true, importedAt: clock.now() }),
      );
      summary.importedSupportingSets.push(supportCode);
    }

    // Rule 5: refuse to save a set that refers to anything we don't have.
    const problems = await inTransaction(async ({ catalog }) => {
      const known = await catalog.knownReferences();
      return missingReferences(setImport, {
        hasPrinting: (id) => known.printingIds.has(id),
        hasProduct: (id) => known.productIds.has(id),
        hasBooster: (setCode, boosterType) => known.boosters.has(`${setCode}/${boosterType}`),
        hasDeck: (setCode, deckName) => known.decks.has(`${setCode}/${deckName}`),
      });
    });
    if (problems.length > 0) {
      summary.failedSets.push({ code, problems });
      return;
    }

    // Rule 3: the whole set in one transaction.
    await inTransaction(({ catalog }) =>
      catalog.saveImport(setImport, { printingsOnly: false, importedAt: clock.now() }),
    );
    summary.importedSets.push(code);
  }

  async function findStandardSets(bulkFilePath: string): Promise<Set<SetCode>> {
    const codes = new Set<SetCode>();
    for await (const card of scryfall.readBulkFile(bulkFilePath)) {
      if (card.language === "en" && countsTowardStandard(card)) codes.add(card.setCode);
    }
    return codes;
  }

  async function pricePass(bulkFilePath: string, summary: SyncSummary): Promise<void> {
    const printings = await inTransaction(({ catalog }) => catalog.printingsForPricing());
    const day = snapshotDay(clock.now());
    const standard = new Set<SetCode>();
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

    for await (const card of scryfall.readBulkFile(bulkFilePath)) {
      // Only English paper cards count (rules 8 and 9).
      if (card.language !== "en" || card.isDigital) continue;
      if (countsTowardStandard(card)) standard.add(card.setCode);

      const printing = printings.get(card.scryfallId);
      if (printing === undefined) continue;
      const todays = priceSnapshots(printing, card, day);
      snapshots.push(...todays);
      extras.push({
        scryfallId: card.scryfallId,
        images: card.images,
        legalities: card.legalities,
      });
      summary.pricedPrintings++;
      summary.priceSnapshots += todays.length;
      if (extras.length >= BATCH_SIZE) await flush();
    }
    await flush();
    await inTransaction(({ catalog }) => catalog.markStandard([...standard]));
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
          ? `${summary.failedSets.length} set(s) could not be imported; see the summary`
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
          error: error instanceof Error ? error.message : String(error),
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

  return { runSync, runNextQueuedSync, recoverInterruptedRuns, queueNightlyIfDue };
}

function addSkipped(summary: SyncSummary, setImport: SetImport) {
  const skipped = summary.skippedDigital;
  skipped.printings += setImport.skipped.printings;
  const prefix = (name: string) => `${setImport.set.code}: ${name}`;
  skipped.boosterTypes.push(...setImport.skipped.boosterTypes.map(prefix));
  skipped.products.push(...setImport.skipped.products.map(prefix));
  skipped.decks.push(...setImport.skipped.decks.map(prefix));
}
