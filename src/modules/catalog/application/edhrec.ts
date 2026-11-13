import { ok } from "@/shared/kernel";
import { commanderSlug, dedupeEdhrecEntries } from "../domain/edhrec";
import type { CatalogDependencies, CatalogServices } from "./ports";

export const EDHREC_STALE_DAYS = 30;
export const EDHREC_NIGHTLY_LIMIT = 200;

export type EdhrecSyncSummary = {
  synced: number;
  notFound: number;
  failed: number;
};

export function emptyEdhrecSummary(): EdhrecSyncSummary {
  return { synced: 0, notFound: 0, failed: 0 };
}

export function makeEdhrecSync(dependencies: CatalogDependencies) {
  const { unitOfWork, clock, edhrec: gateway } = dependencies;

  async function inTransaction<T>(work: (services: CatalogServices) => Promise<T>): Promise<T> {
    const result = await unitOfWork.run<T, never>(async (services) => ok(await work(services)));
    if (!result.ok) throw new Error("unreachable");
    return result.value;
  }

  async function syncEdhrec(options?: {
    limit?: number;
    force?: boolean;
  }): Promise<EdhrecSyncSummary> {
    const summary = emptyEdhrecSummary();
    if (!gateway) return summary;

    const limit = options?.limit ?? EDHREC_NIGHTLY_LIMIT;
    const now = clock.now();
    const staleBefore = options?.force
      ? new Date(now.getTime() + 86_400_000)
      : new Date(now.getTime() - EDHREC_STALE_DAYS * 86_400_000);

    const targets = await inTransaction(({ edhrec }) =>
      edhrec ? edhrec.commandersToSync(staleBefore, limit) : Promise.resolve([]),
    );

    for (const target of targets) {
      const slug = commanderSlug(target.name);
      if (slug.length === 0) continue;

      try {
        const page = await gateway.commanderPage(slug);
        const fetchedAt = clock.now();
        if (page === null) {
          await inTransaction(({ edhrec }) =>
            edhrec
              ? edhrec.saveCommanderData(target.oracleId, slug, "not_found", 0, [], fetchedAt)
              : Promise.resolve(),
          );
          summary.notFound++;
          continue;
        }

        const deduped = dedupeEdhrecEntries(page.cards);
        const oracleByName = await inTransaction(({ edhrec }) =>
          edhrec
            ? edhrec.resolveOracleIdsByName(deduped.map((entry) => entry.cardName))
            : Promise.resolve(new Map<string, string>()),
        );

        // Deduplicate again by resolved oracleId in case two names map to the same oracle card.
        const byOracle = new Map<
          string,
          { cardOracleId: string; inclusionRate: number; synergy: number }
        >();
        for (const entry of deduped) {
          const cardOracleId = oracleByName.get(entry.cardName.toLowerCase());
          if (cardOracleId === undefined || cardOracleId === target.oracleId) continue;
          const prev = byOracle.get(cardOracleId);
          if (
            prev === undefined ||
            entry.inclusionRate > prev.inclusionRate ||
            (entry.inclusionRate === prev.inclusionRate && entry.synergy > prev.synergy)
          ) {
            byOracle.set(cardOracleId, {
              cardOracleId,
              inclusionRate: entry.inclusionRate,
              synergy: entry.synergy,
            });
          }
        }

        await inTransaction(({ edhrec }) =>
          edhrec
            ? edhrec.saveCommanderData(
                target.oracleId,
                slug,
                "ok",
                page.totalDecks,
                [...byOracle.values()],
                fetchedAt,
              )
            : Promise.resolve(),
        );
        summary.synced++;
      } catch {
        summary.failed++;
      }
    }

    return summary;
  }

  return { syncEdhrec };
}
