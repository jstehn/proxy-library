import { describe, expect, it } from "vitest";
import { DEFAULT_PROXY_OPTIONS, type ProxyLine, type ProxyPage } from "../domain/proxy-sheet";
import { fakeProxyImages } from "../testing/fakes";
import { printedCard } from "../testing/printed-cards";
import { makeProxySheets } from "./proxy-sheets";

const line = (name: string, quantity: number, hasBack = false): ProxyLine => ({
  printingId: name,
  name,
  quantity,
  board: "main",
  isBasicLand: false,
  hasBack,
  isFoil: false,
  printed: printedCard(),
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

  it("reports each image fetched, then hands its progress callback to the renderer", async () => {
    const { images } = fakeProxyImages(["delver"]);
    const seen: string[] = [];
    const proxySheet = makeProxySheets({
      images,
      renderer: {
        async render(_pages, _fetched, _options, onProgress) {
          onProgress?.({ stage: "pages", done: 1, total: 1 });
          return new Uint8Array([1]);
        },
      },
    });
    await proxySheet(
      [line("bolt", 4), line("delver", 1, true)],
      DEFAULT_PROXY_OPTIONS,
      (progress) => seen.push(`${progress.stage} ${progress.done}/${progress.total}`),
    );
    expect(seen).toEqual(["images 0/3", "images 1/3", "images 2/3", "images 3/3", "pages 1/1"]);
  });

  it("fetches nothing for playtest cards without art, and says so", async () => {
    const { images, requests } = fakeProxyImages();
    const seen: string[] = [];
    const proxySheet = makeProxySheets({
      images,
      renderer: { render: async () => new Uint8Array([1]) },
    });
    await proxySheet(
      [line("bolt", 2)],
      { ...DEFAULT_PROXY_OPTIONS, style: "playtest", artFilter: "none" },
      (progress) => seen.push(`${progress.stage} ${progress.done}/${progress.total}`),
    );
    expect(requests).toEqual([]);
    expect(seen).toEqual(["images 0/0"]);
  });
});
