import { describe, expect, it } from "vitest";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { makeEdhrecSync } from "./edhrec";
import type {
  ArtworkRepository,
  CatalogDependencies,
  CatalogRepository,
  CatalogServices,
  EdhrecGateway,
  EdhrecRepository,
  SyncRunRepository,
} from "./ports";

function fakeDeps(
  targets: Array<{ oracleId: string; name: string }>,
  pages: Record<
    string,
    | {
        slug: string;
        totalDecks: number;
        cards: Array<{
          cardName: string;
          numDecks: number;
          potentialDecks: number;
          inclusionRate: number;
          synergy: number;
        }>;
      }
    | null
    | Error
  >,
  oracleMap: Record<string, string>,
) {
  const saved: Array<{
    commanderOracleId: string;
    slug: string;
    status: "ok" | "not_found";
    totalDecks: number;
    entries: ReadonlyArray<{ cardOracleId: string; inclusionRate: number; synergy: number }>;
  }> = [];

  const edhrecRepo: EdhrecRepository = {
    async commandersToSync() {
      return targets;
    },
    async resolveOracleIdsByName(names) {
      const map = new Map<string, string>();
      for (const name of names) {
        const found = oracleMap[name.toLowerCase()];
        if (found !== undefined) map.set(name.toLowerCase(), found);
      }
      return map;
    },
    async saveCommanderData(commanderOracleId, slug, status, totalDecks, entries) {
      saved.push({ commanderOracleId, slug, status, totalDecks, entries });
    },
  };

  const edhrecGateway: EdhrecGateway = {
    async commanderPage(slug) {
      const entry = pages[slug];
      if (entry instanceof Error) throw entry;
      return entry ?? null;
    },
  };

  const services: CatalogServices = {
    catalog: {} as CatalogRepository,
    syncRuns: {} as SyncRunRepository,
    artwork: {} as ArtworkRepository,
    edhrec: edhrecRepo,
  };

  const deps: CatalogDependencies = {
    unitOfWork: inMemoryUnitOfWork(services),
    extraPricedPrintings: { printingIds: async () => [] },
    mtgjson: {} as CatalogDependencies["mtgjson"],
    scryfall: {} as CatalogDependencies["scryfall"],
    images: {} as CatalogDependencies["images"],
    imageFetcher: {} as CatalogDependencies["imageFetcher"],
    wpn: {} as CatalogDependencies["wpn"],
    artworkFiles: {} as CatalogDependencies["artworkFiles"],
    edhrec: edhrecGateway,
    clock: fixedClock("2026-11-12T00:00:00Z"),
    syncTime: { hour: 3, minute: 0 },
  };

  return { deps, saved };
}

describe("makeEdhrecSync", () => {
  it("syncs found commanders, records 404s, and continues past errors", async () => {
    const { deps, saved } = fakeDeps(
      [
        { oracleId: "cmd-atraxa", name: "Atraxa, Praetors' Voice" },
        { oracleId: "cmd-missing", name: "Unknown Legend" },
        { oracleId: "cmd-error", name: "Broken Legend" },
      ],
      {
        "atraxa-praetors-voice": {
          slug: "atraxa-praetors-voice",
          totalDecks: 15000,
          cards: [
            {
              cardName: "Sol Ring",
              numDecks: 12000,
              potentialDecks: 15000,
              inclusionRate: 0.8,
              synergy: 0.05,
            },
            {
              cardName: "Unmapped Card",
              numDecks: 500,
              potentialDecks: 15000,
              inclusionRate: 0.03,
              synergy: 0.1,
            },
          ],
        },
        "unknown-legend": null,
        "broken-legend": new Error("network timeout"),
      },
      { "sol ring": "oracle-sol-ring" },
    );

    const { syncEdhrec } = makeEdhrecSync(deps);
    const summary = await syncEdhrec();

    expect(summary).toEqual({ synced: 1, notFound: 1, failed: 1 });
    expect(saved).toEqual([
      {
        commanderOracleId: "cmd-atraxa",
        slug: "atraxa-praetors-voice",
        status: "ok",
        totalDecks: 15000,
        entries: [{ cardOracleId: "oracle-sol-ring", inclusionRate: 0.8, synergy: 0.05 }],
      },
      {
        commanderOracleId: "cmd-missing",
        slug: "unknown-legend",
        status: "not_found",
        totalDecks: 0,
        entries: [],
      },
    ]);
  });
});
