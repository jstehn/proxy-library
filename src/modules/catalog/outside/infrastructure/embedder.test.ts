import { beforeEach, describe, expect, it, vi } from "vitest";

const { pipelineMock } = vi.hoisted(() => ({
  pipelineMock: vi.fn(),
}));

vi.mock("@huggingface/transformers", () => ({
  pipeline: pipelineMock,
}));

import { huggingFaceTextEmbedder } from "./embedder";

describe("huggingFaceTextEmbedder", () => {
  beforeEach(() => {
    pipelineMock.mockReset();
  });

  it("resets extractorPromise after an init failure so subsequent calls retry", async () => {
    const extractor = vi.fn(async (texts: string[]) => ({
      dims: [texts.length, 2],
      data: texts.flatMap((_, index) => [index + 1, 0.5]),
    }));
    pipelineMock.mockRejectedValueOnce(new Error("transient ONNX load failure"));
    pipelineMock.mockResolvedValueOnce(extractor);

    const embed = huggingFaceTextEmbedder("test-model");
    await expect(embed(["sacrifice outlet"])).rejects.toThrow("transient ONNX load failure");

    const vectors = await embed(["sacrifice outlet"]);
    expect(vectors).toEqual([[1, 0.5]]);
    expect(pipelineMock).toHaveBeenCalledTimes(2);
    expect(extractor).toHaveBeenCalledTimes(1);
  });

  it("caches single-text embeddings with bounded 200-entry LRU eviction", async () => {
    const extractor = vi.fn(async (texts: string[]) => ({
      dims: [texts.length, 2],
      data: texts.flatMap((text) => [text.length, 1]),
    }));
    pipelineMock.mockResolvedValue(extractor);

    const embed = huggingFaceTextEmbedder("test-model");

    // Cache hit skips extractor on repeat single-text queries.
    const first = await embed(["ramp"]);
    const second = await embed(["ramp"]);
    expect(first).toEqual([[4, 1]]);
    expect(second).toEqual([[4, 1]]);
    expect(extractor).toHaveBeenCalledTimes(1);

    // Multi-text batches bypass single-text cache.
    const batch = await embed(["ramp", "draw"]);
    expect(batch).toEqual([
      [4, 1],
      [4, 1],
    ]);
    expect(extractor).toHaveBeenCalledTimes(2);

    // Fill cache to 200 entries total ("ramp" + 199 new keys), refreshing "ramp" before adding #201.
    for (let i = 0; i < 199; i++) {
      await embed([`query-${i}`]);
    }
    expect(extractor).toHaveBeenCalledTimes(201);

    // Refresh "ramp" (cache hit) so "query-0" becomes the least recently used entry.
    await embed(["ramp"]);
    expect(extractor).toHaveBeenCalledTimes(201);

    // Adding entry 201 ("query-200") evicts "query-0", keeping "ramp".
    await embed(["query-200"]);
    expect(extractor).toHaveBeenCalledTimes(202);

    await embed(["ramp"]);
    expect(extractor).toHaveBeenCalledTimes(202);

    await embed(["query-0"]);
    expect(extractor).toHaveBeenCalledTimes(203);
  });
});
