import { EMBEDDING_MODEL } from "../domain/embedding-text";
import type { TextEmbedder } from "../application/ports";

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ dims: number[]; data: ArrayLike<number> }>;

const SINGLE_TEXT_CACHE_MAX_ENTRIES = 200;

/**
 * Local ONNX text embedder powered by `@huggingface/transformers` (design doc 53, #58).
 * Loads the model lazily on first call so web routes that never embed pay zero startup cost.
 */
export function huggingFaceTextEmbedder(model = EMBEDDING_MODEL): TextEmbedder {
  let extractorPromise: Promise<FeatureExtractor> | null = null;
  const singleTextCache = new Map<string, number[]>();

  function getExtractor(): Promise<FeatureExtractor> {
    if (!extractorPromise) {
      extractorPromise = import("@huggingface/transformers")
        .then(
          ({ pipeline }) =>
            pipeline("feature-extraction", model, {
              dtype: "q8",
            }) as Promise<unknown> as Promise<FeatureExtractor>,
        )
        .catch((error: unknown) => {
          extractorPromise = null;
          throw error;
        });
    }
    return extractorPromise;
  }

  return async function embedTexts(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const singleKey = texts.length === 1 ? texts[0] : undefined;
    if (singleKey !== undefined) {
      const cached = singleTextCache.get(singleKey);
      if (cached) {
        singleTextCache.delete(singleKey);
        singleTextCache.set(singleKey, cached);
        return [[...cached]];
      }
    }

    const extractor = await getExtractor();
    const out = await extractor([...texts], { pooling: "mean", normalize: true });
    const dims = out.dims[1] ?? 0;
    if (dims === 0) return [];
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const start = i * dims;
      const vec: number[] = new Array(dims);
      for (let j = 0; j < dims; j++) {
        vec[j] = Number(out.data[start + j]);
      }
      vectors.push(vec);
    }

    if (singleKey !== undefined && vectors[0] !== undefined) {
      if (singleTextCache.size >= SINGLE_TEXT_CACHE_MAX_ENTRIES) {
        const oldestKey = singleTextCache.keys().next().value;
        if (oldestKey !== undefined) singleTextCache.delete(oldestKey);
      }
      singleTextCache.set(singleKey, [...vectors[0]]);
    }

    return vectors;
  };
}
