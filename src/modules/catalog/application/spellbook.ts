import { ok } from "@/shared/kernel";
import type { CatalogDependencies, CatalogServices } from "./ports";

export const SPELLBOOK_STALE_DAYS = 7;

export type SpellbookSyncSummary = {
  synced: number;
  skipped: boolean;
  failed: boolean;
};

export function makeSpellbookSync(dependencies: CatalogDependencies) {
  const { unitOfWork, clock, spellbook: gateway } = dependencies;

  async function inTransaction<T>(work: (services: CatalogServices) => Promise<T>): Promise<T> {
    const result = await unitOfWork.run<T, never>(async (services) => ok(await work(services)));
    if (!result.ok) throw new Error("unreachable");
    return result.value;
  }

  async function syncSpellbookCombos(options?: { force?: boolean }): Promise<SpellbookSyncSummary> {
    if (!gateway) return { synced: 0, skipped: true, failed: false };

    const now = clock.now();
    const lastSynced = await inTransaction(({ spellbook }) =>
      spellbook ? spellbook.lastSyncedAt() : Promise.resolve(null),
    );
    const staleBefore = new Date(now.getTime() - SPELLBOOK_STALE_DAYS * 86_400_000);
    if (!options?.force && lastSynced !== null && lastSynced > staleBefore) {
      return { synced: 0, skipped: true, failed: false };
    }

    try {
      const combos = await gateway.fetchTwoCardCombos();
      const syncedAt = clock.now();
      await inTransaction(async ({ spellbook }) => {
        if (spellbook) await spellbook.replaceTwoCardCombos(combos, syncedAt);
      });
      return { synced: combos.length, skipped: false, failed: false };
    } catch {
      return { synced: 0, skipped: false, failed: true };
    }
  }

  return { syncSpellbookCombos };
}
