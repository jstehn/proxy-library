// File-based gateways that read the recorded real data in tests/fixtures instead of calling
// MTGJSON and Scryfall. They are adapters like the HTTP ones, and go through the same
// anti-corruption layer (schemas + mappers), so fixtures are checked exactly like live data.
import { readFileSync } from "node:fs";
import type { MtgjsonGateway, ScryfallGateway } from "../application/ports";
import type { SetCode } from "../domain/types";
import { mapSetFile, mapSetSummary } from "./mtgjson-mapper";
import { MtgjsonMetaFile, MtgjsonSetFile, MtgjsonSetListFile } from "./mtgjson-schema";
import { mapScryfallCard, ScryfallCardSchema } from "./scryfall";

const FIXTURES = "tests/fixtures";
const read = (path: string): unknown => JSON.parse(readFileSync(`${FIXTURES}/${path}`, "utf8"));

/** MTGJSON from fixture files. `hideSets` pretends some sets don't exist (to test failures). */
export function fixtureMtgjsonGateway(options: { hideSets?: string[] } = {}) {
  const hidden = new Set(options.hideSets ?? []);
  const downloads: string[] = [];

  const gateway: MtgjsonGateway = {
    async metaVersion() {
      return MtgjsonMetaFile.parse(read("mtgjson/Meta.json")).data.version;
    },
    async setList() {
      return MtgjsonSetListFile.parse(read("mtgjson/SetList.json"))
        .data.filter((entry) => !hidden.has(entry.code))
        .map((entry) => ({ set: mapSetSummary(entry), isOnlineOnly: entry.isOnlineOnly }));
    },
    async setFile(code: SetCode) {
      downloads.push(code);
      return mapSetFile(MtgjsonSetFile.parse(read(`mtgjson/${code}.json`)));
    },
  };
  return { ...gateway, downloads };
}

/** Scryfall's bulk file from the fixture (plain JSON Lines; the real gateway reads gzip). */
export function fixtureScryfallGateway(
  updatedAt = new Date("2026-09-27T09:05:41Z"),
): ScryfallGateway {
  const path = `${FIXTURES}/scryfall/default-cards.jsonl`;
  return {
    async latestBulkFile() {
      return { path, updatedAt, downloaded: false };
    },
    async *readBulkFile(filePath: string) {
      for (const line of readFileSync(filePath, "utf8").split("\n")) {
        if (line.trim() !== "") yield mapScryfallCard(ScryfallCardSchema.parse(JSON.parse(line)));
      }
    },
  };
}
