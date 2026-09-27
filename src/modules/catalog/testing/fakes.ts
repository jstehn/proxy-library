// In-memory test doubles for the catalog's image ports.
import type { ImageFetcher, ImageKey, ImageStore } from "../application/ports";

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
