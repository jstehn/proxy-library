// Adapters for MTGJSON, Scryfall and the image cache (design doc 04, section 6).
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip, gunzipSync } from "node:zlib";
import { downloadToFile, fetchBytes, fetchJson, type Fetch } from "@/shared/http";
import type {
  ArtworkStore,
  ImageFetcher,
  ImageKey,
  ImageStore,
  MtgjsonGateway,
  ScryfallGateway,
} from "../application/ports";
import type { SetCode } from "../domain/types";
import { mapSetFile, mapSetSummary } from "./mtgjson-mapper";
import { MtgjsonMetaFile, MtgjsonSetFile, MtgjsonSetListFile } from "./mtgjson-schema";
import { mapScryfallCard, ScryfallBulkDataSchema, ScryfallCardSchema } from "./scryfall";

const MTGJSON_BASE = "https://mtgjson.com/api/v5";
const SCRYFALL_API = "https://api.scryfall.com";

/** Downloads a gzipped JSON file and parses it (MTGJSON serves .json.gz files). */
async function fetchGzippedJson(fetchFn: Fetch, url: string): Promise<unknown> {
  const bytes = await fetchBytes(fetchFn, url);
  return JSON.parse(gunzipSync(bytes).toString("utf8"));
}

export function httpMtgjsonGateway(fetchFn: Fetch): MtgjsonGateway {
  return {
    async metaVersion() {
      const meta = MtgjsonMetaFile.parse(await fetchJson(fetchFn, `${MTGJSON_BASE}/Meta.json`));
      return meta.data.version;
    },
    async setList() {
      const file = MtgjsonSetListFile.parse(
        await fetchGzippedJson(fetchFn, `${MTGJSON_BASE}/SetList.json.gz`),
      );
      return file.data.map((entry) => ({
        set: mapSetSummary(entry),
        isOnlineOnly: entry.isOnlineOnly,
      }));
    },
    async setFile(code: SetCode) {
      const file = MtgjsonSetFile.parse(
        await fetchGzippedJson(fetchFn, `${MTGJSON_BASE}/${code}.json.gz`),
      );
      return mapSetFile(file);
    },
  };
}

/**
 * Scryfall's bulk file, cached in `cacheDirectory`. Scryfall asks that bulk files be downloaded
 * at most once per update, so we only fetch when their `updated_at` changes.
 */
export function httpScryfallGateway(fetchFn: Fetch, cacheDirectory: string): ScryfallGateway {
  const directory = join(cacheDirectory, "scryfall");
  const PREFIX = "default-cards-";

  return {
    async latestBulkFile() {
      const info = ScryfallBulkDataSchema.parse(
        await fetchJson(fetchFn, `${SCRYFALL_API}/bulk-data/default-cards`),
      );
      const updatedAt = new Date(info.updated_at);
      const fileName = `${PREFIX}${updatedAt.toISOString().replace(/[^0-9]/g, "")}.jsonl.gz`;
      const path = join(directory, fileName);

      await mkdir(directory, { recursive: true });
      const existing = await readdir(directory);
      if (existing.includes(fileName)) return { path, updatedAt, downloaded: false };

      await downloadToFile(fetchFn, info.jsonl_download_uri, path);
      // Keep only the newest copy.
      for (const old of existing.filter((name) => name.startsWith(PREFIX) && name !== fileName)) {
        await rm(join(directory, old), { force: true });
      }
      return { path, updatedAt, downloaded: true };
    },

    async *readBulkFile(path: string) {
      // gzip file → unzip as it's read → split into lines → one card per line. The 79 MB file
      // (over 500 MB unzipped) is never held in memory at once.
      const lines = createInterface({
        input: createReadStream(path).pipe(createGunzip()),
        crlfDelay: Infinity,
      });
      let invalidLines = 0;
      for await (const line of lines) {
        if (line.trim() === "") continue;
        const parsed = ScryfallCardSchema.safeParse(JSON.parse(line));
        if (!parsed.success) {
          invalidLines++;
          continue; // one odd card shouldn't stop the whole sync
        }
        yield mapScryfallCard(parsed.data);
      }
      if (invalidLines > 0)
        console.warn(`scryfall bulk file: skipped ${invalidLines} unreadable line(s)`);
    },
  };
}

/** Card images on disk: <root>/<size>/<scryfallId>-<face>.jpg */
export function diskImageStore(root: string): ImageStore {
  const pathFor = (key: ImageKey) => join(root, key.size, `${key.scryfallId}-${key.face}.jpg`);

  return {
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async put(key, bytes) {
      const path = pathFor(key);
      await mkdir(join(root, key.size), { recursive: true });
      // Write-then-rename: a reader never sees a half-written image.
      const partial = `${path}.partial-${process.pid}`;
      await writeFile(partial, bytes);
      await rename(partial, path);
    },
  };
}

/** Product photos and key art on disk: <root>/artwork/<size>/<imageId>.webp (design doc 13). */
export function diskArtworkStore(root: string): ArtworkStore {
  const SAFE_ID = /^[A-Za-z0-9-]+$/;
  function pathFor(imageId: string, size: string): string {
    if (!SAFE_ID.test(imageId)) throw new RangeError(`not an artwork id: ${imageId}`);
    return join(root, "artwork", size, `${imageId}.webp`);
  }
  return {
    async get(imageId, size) {
      try {
        return new Uint8Array(await readFile(pathFor(imageId, size)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async put(imageId, size, bytes) {
      const path = pathFor(imageId, size);
      await mkdir(join(root, "artwork", size), { recursive: true });
      const partial = `${path}.partial-${process.pid}`;
      await writeFile(partial, bytes);
      await rename(partial, path);
    },
  };
}

export function httpImageFetcher(fetchFn: Fetch): ImageFetcher {
  return { fetch: (url) => fetchBytes(fetchFn, url) };
}
