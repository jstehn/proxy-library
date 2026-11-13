import { describe, expect, it } from "vitest";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { makeEmbedCards } from "./embed";
import type {
  ArtworkRepository,
  CardEmbeddingRow,
  CardTextToEmbed,
  CatalogDependencies,
  CatalogRepository,
  CatalogServices,
  EmbeddingRepository,
  SyncRunRepository,
} from "./ports";

function fakeDeps(missing: CardTextToEmbed[]) {
  const saved: CardEmbeddingRow[] = [];
  const receivedTexts: string[][] = [];

  const embeddings: EmbeddingRepository = {
    async listMissingOrStale(_model, _textVersion, limit) {
      return limit !== undefined ? missing.slice(0, limit) : missing;
    },
    async upsertBatch(rows) {
      saved.push(...rows);
    },
  };

  const services: CatalogServices = {
    catalog: {} as CatalogRepository,
    syncRuns: {} as SyncRunRepository,
    artwork: {} as ArtworkRepository,
    embeddings,
  };

  const deps: CatalogDependencies = {
    unitOfWork: inMemoryUnitOfWork(services),
    extraPricedPrintings: {
      async printingIds() {
        return [];
      },
    },
    mtgjson: {} as CatalogDependencies["mtgjson"],
    scryfall: {} as CatalogDependencies["scryfall"],
    images: {} as CatalogDependencies["images"],
    imageFetcher: {} as CatalogDependencies["imageFetcher"],
    wpn: {} as CatalogDependencies["wpn"],
    artworkFiles: {} as CatalogDependencies["artworkFiles"],
    textEmbedder: async (texts) => {
      receivedTexts.push([...texts]);
      return texts.map((_, idx) => [idx + 1, 0, 0]);
    },
    clock: fixedClock(new Date("2026-11-13T00:00:00Z")),
    syncTime: { hour: 4, minute: 0 },
  };

  return { deps, saved, receivedTexts };
}

describe("makeEmbedCards", () => {
  it("cleans card text, batches embeddings, and upserts them", async () => {
    const { deps, saved, receivedTexts } = fakeDeps([
      {
        oracleId: "o1",
        name: "Llanowar Elves",
        typeLine: "Creature — Elf Druid",
        text: "{T}: Add {G}. (Reminder)",
      },
      {
        oracleId: "o2",
        name: "Elvish Mystic",
        typeLine: "Creature — Elf Druid",
        text: "{T}: Add {G}.",
      },
      {
        oracleId: "o3",
        name: "Sol Ring",
        typeLine: "Artifact",
        text: "{T}: Add {C}{C}.",
      },
    ]);

    const { embedCards } = makeEmbedCards(deps);
    const summary = await embedCards({ batchSize: 2 });

    expect(summary).toEqual({ embedded: 3, batches: 2 });
    expect(receivedTexts).toEqual([
      ["Creature — Elf Druid\n{T}: Add {G}.", "Creature — Elf Druid\n{T}: Add {G}."],
      ["Artifact\n{T}: Add {C}{C}."],
    ]);
    expect(saved.map((r) => r.oracleId)).toEqual(["o1", "o2", "o3"]);
  });

  it("returns zero when nothing is missing", async () => {
    const { deps, saved } = fakeDeps([]);
    const { embedCards } = makeEmbedCards(deps);
    expect(await embedCards()).toEqual({ embedded: 0, batches: 0 });
    expect(saved).toHaveLength(0);
  });
});
