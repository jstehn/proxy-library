import { describe, expect, it } from "vitest";
import { DEFAULT_PROXY_OPTIONS, type ProxyLine, type ProxyPage } from "../domain/proxy-sheet";
import { fakeProxyImages } from "../testing/fakes";
import { makeProxySheets } from "./proxy-sheets";

const line = (name: string, quantity: number, hasBack = false): ProxyLine => ({
  printingId: name,
  name,
  quantity,
  board: "main",
  isBasicLand: false,
  hasBack,
});

describe("proxySheet", () => {
  it("fetches each image once, however many copies, and hands the pages to the renderer", async () => {
    const { images, requests } = fakeProxyImages(["delver"]);
    type Render = { pages: readonly ProxyPage[]; images: ReadonlyMap<string, Uint8Array> };
    const renders: Render[] = [];
    const proxySheet = makeProxySheets({
      images,
      renderer: {
        async render(pages, fetched) {
          renders.push({ pages, images: fetched });
          return new Uint8Array([1]);
        },
      },
    });

    const pdf = await proxySheet([line("bolt", 4), line("delver", 1, true)], DEFAULT_PROXY_OPTIONS);
    expect(pdf).toEqual(new Uint8Array([1]));
    expect(requests.sort()).toEqual(["bolt/front", "delver/back", "delver/front"]);
    expect(renders).toHaveLength(1);
    const [{ pages, images: fetched }] = renders;
    expect(pages.map((page) => page.side)).toEqual(["front", "front", "back"]);
    expect([...fetched.keys()].sort()).toEqual(["bolt/front", "delver/back", "delver/front"]);
  });
});
