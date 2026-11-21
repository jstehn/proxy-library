// Remote checks (design doc 11, section 5): the only tests that call the real MTGJSON, Scryfall
// and Wizards Play Network. Never part of `pnpm test`, `check` or `test:int`; run them by hand
// with `pnpm test:remote` to notice when a service changes its format. Three small requests.
import { describe, expect, it } from "vitest";
import { fetchJson, platformFetch, withUserAgent } from "@/shared/http";
import { MtgjsonMetaFile } from "./mtgjson-schema";
import { ScryfallBulkDataSchema } from "./scryfall";
import { httpWpnGateway } from "./wpn";

const politeFetch = withUserAgent("ProxyLibrary/1.0 (self-hosted playgroup app; remote test)")(
  platformFetch,
);

describe("live data sources still match our schemas", () => {
  it("MTGJSON's Meta.json", async () => {
    const meta = MtgjsonMetaFile.parse(
      await fetchJson(politeFetch, "https://mtgjson.com/api/v5/Meta.json"),
    );
    expect(meta.data.version).toMatch(/^5\./);
  });

  it("Scryfall's default-cards bulk-data description (not the file itself)", async () => {
    const info = ScryfallBulkDataSchema.parse(
      await fetchJson(politeFetch, "https://api.scryfall.com/bulk-data/default-cards"),
    );
    expect(info).toBeDefined();
  });

  it("a WPN product page (design doc 13): products, photos and key art", async () => {
    const page = await httpWpnGateway(politeFetch, politeFetch).setPage("bloomburrow");
    expect(page?.products.map((product) => product.name)).toContain("Bloomburrow Play Booster");
    expect(page?.products.every((product) => product.images.length > 0)).toBe(true);
    expect(page?.keyArt).not.toBeNull();
  });
});
