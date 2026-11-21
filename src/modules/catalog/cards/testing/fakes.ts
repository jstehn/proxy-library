// In-memory test doubles for the catalog's image ports.
import type { CardFeatureStore, ImageFetcher, ImageKey, ImageStore } from "../application/ports";
import type { CardFeatures, CardText } from "../domain/features/types";

export function inMemoryImageStore() {
  const files = new Map<string, Uint8Array>();
  const keyOf = (key: ImageKey) => `${key.size}/${key.scryfallId}-${key.face}`;
  const store: ImageStore = {
    async get(key) {
      return files.get(keyOf(key)) ?? null;
    },
    async put(key, bytes) {
      files.set(keyOf(key), bytes);
    },
  };
  return { ...store, files };
}

/** Returns a tiny fake "image" for any URL, and records what was fetched. */
export function fakeImageFetcher() {
  const fetched: string[] = [];
  const fetcher: ImageFetcher = {
    async fetch(url) {
      fetched.push(url);
      return new TextEncoder().encode(`image:${url}`);
    },
  };
  return { ...fetcher, fetched };
}

/** The card features store in memory: `cards` are the oracle cards that exist. */
export function inMemoryCardFeatureStore(cards: readonly CardText[]) {
  const rows = new Map<string, CardFeatures>();
  const store: CardFeatureStore = {
    async textsToCompute(version, limit) {
      const stale = (card: CardText) => (rows.get(card.oracleId)?.featuresVersion ?? 0) < version;
      return cards.filter(stale).slice(0, limit);
    },
    async save(toSave) {
      for (const row of toSave) rows.set(row.oracleId, row.features);
    },
  };
  return { ...store, rows };
}
