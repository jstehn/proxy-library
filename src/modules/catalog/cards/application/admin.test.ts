import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { PrintingId } from "../domain/types";
import { inMemoryImageStore } from "../testing/fakes";
import { makeCatalogAdmin } from "./admin";
import type {
  CardsDependencies,
  CardsServices,
  CatalogRepository,
  ImageFetcher,
  ImageSource,
} from "./ports";

function makeSource(scryfallId: string): ImageSource {
  return {
    scryfallId,
    images: {
      front: {
        small: `https://cards.scryfall.io/small/${scryfallId}.jpg`,
        normal: `https://cards.scryfall.io/normal/${scryfallId}.jpg`,
        large: `https://cards.scryfall.io/large/${scryfallId}.jpg`,
      },
      back: null,
    },
  };
}

function setup(overrides?: {
  readImageSource?: CardsDependencies["readImageSource"];
  unitOfWork?: CardsDependencies["unitOfWork"];
  imageFetcher?: ImageFetcher;
}) {
  const images = inMemoryImageStore();
  const putSpy = vi.spyOn(images, "put");
  const defaultFetcher: ImageFetcher = {
    fetch: vi.fn(async (url: string) => new TextEncoder().encode(`bytes:${url}`)),
  };
  const imageFetcher = overrides?.imageFetcher ?? defaultFetcher;
  const fallbackServices = {
    catalog: {
      imageSource: vi.fn(async () => null),
    } as unknown as CatalogRepository,
  } as unknown as CardsServices;

  const dependencies = {
    unitOfWork: overrides?.unitOfWork ?? inMemoryUnitOfWork(fallbackServices),
    images,
    imageFetcher,
    readImageSource: overrides?.readImageSource,
    clock: fixedClock(new Date("2026-11-26T00:00:00Z")),
  } as unknown as CardsDependencies;

  return {
    admin: makeCatalogAdmin(dependencies),
    images,
    putSpy,
    imageFetcher,
  };
}

describe("makeCatalogAdmin.imageFor", () => {
  it("uses readImageSource on miss and serves subsequent calls from the LRU cache without DB reads", async () => {
    const unitOfWorkRun = vi.fn();
    const readImageSource = vi.fn(async () => makeSource("scry-1"));
    const { admin } = setup({
      readImageSource,
      unitOfWork: { run: unitOfWorkRun } as unknown as CardsDependencies["unitOfWork"],
    });

    const first = await admin.imageFor({
      printingId: PrintingId.of("p-1"),
      size: "small",
      face: "front",
    });
    const second = await admin.imageFor({
      printingId: PrintingId.of("p-1"),
      size: "large",
      face: "front",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(readImageSource).toHaveBeenCalledTimes(1);
    expect(unitOfWorkRun).not.toHaveBeenCalled();
  });

  it("does not cache null image sources and falls back to unitOfWork when readImageSource is omitted", async () => {
    const imageSource = vi
      .fn<CatalogRepository["imageSource"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeSource("scry-2"));
    const services = {
      catalog: { imageSource } as unknown as CatalogRepository,
    } as unknown as CardsServices;
    const { admin } = setup({ unitOfWork: inMemoryUnitOfWork(services) });

    expect(
      await admin.imageFor({
        printingId: PrintingId.of("p-missing"),
        size: "small",
        face: "front",
      }),
    ).toEqual(err({ kind: "ImageNotFound" }));
    const found = await admin.imageFor({
      printingId: PrintingId.of("p-missing"),
      size: "small",
      face: "front",
    });
    expect(found.ok).toBe(true);
    expect(imageSource).toHaveBeenCalledTimes(2);
  });

  it("evicts the least-recently-used source once the 5,000-entry LRU limit is exceeded", async () => {
    const readImageSource = vi.fn(async (id: PrintingId) => makeSource(`scry-${id}`));
    const { admin } = setup({ readImageSource });

    for (let index = 0; index < 5_000; index++) {
      await admin.imageFor({
        printingId: PrintingId.of(`p-${index}`),
        size: "small",
        face: "front",
      });
    }
    expect(readImageSource).toHaveBeenCalledTimes(5_000);

    // Touch p-0 so p-1 becomes the least recently used entry.
    await admin.imageFor({ printingId: PrintingId.of("p-0"), size: "small", face: "front" });
    expect(readImageSource).toHaveBeenCalledTimes(5_000);

    // Inserting p-5000 evicts p-1, not p-0.
    await admin.imageFor({ printingId: PrintingId.of("p-5000"), size: "small", face: "front" });
    await admin.imageFor({ printingId: PrintingId.of("p-0"), size: "small", face: "front" });
    expect(readImageSource).toHaveBeenCalledTimes(5_001);

    await admin.imageFor({ printingId: PrintingId.of("p-1"), size: "small", face: "front" });
    expect(readImageSource).toHaveBeenCalledTimes(5_002);
  });

  it("coalesces concurrent cold fetches so Scryfall is hit once and disk is written once", async () => {
    let resolveFetch!: (bytes: Uint8Array) => void;
    const fetchSpy = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const readImageSource = vi.fn(async () => makeSource("scry-cold"));
    const { admin, putSpy } = setup({
      readImageSource,
      imageFetcher: { fetch: fetchSpy },
    });

    const firstPromise = admin.imageFor({
      printingId: PrintingId.of("p-cold"),
      size: "normal",
      face: "front",
    });
    const secondPromise = admin.imageFor({
      printingId: PrintingId.of("p-cold"),
      size: "normal",
      face: "front",
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const expectedBytes = new Uint8Array([9, 8, 7]);
    resolveFetch(expectedBytes);

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toEqual(ok(expectedBytes));
    expect(second).toEqual(ok(expectedBytes));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it("cleans up the in-flight entry when a fetch fails so later requests can retry", async () => {
    const fetchSpy = vi
      .fn<ImageFetcher["fetch"]>()
      .mockRejectedValueOnce(new Error("scryfall 503"))
      .mockResolvedValueOnce(new Uint8Array([4, 2]));
    const { admin } = setup({
      readImageSource: async () => makeSource("scry-retry"),
      imageFetcher: { fetch: fetchSpy },
    });

    const request = {
      printingId: PrintingId.of("p-retry"),
      size: "small" as const,
      face: "front" as const,
    };
    await expect(Promise.all([admin.imageFor(request), admin.imageFor(request)])).rejects.toThrow(
      "scryfall 503",
    );

    const retried = await admin.imageFor(request);
    expect(retried).toEqual(ok(new Uint8Array([4, 2])));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
