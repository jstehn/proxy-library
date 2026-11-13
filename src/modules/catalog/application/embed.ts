import { ok } from "@/shared/kernel";
import { cleanCardText, EMBEDDING_MODEL, EMBEDDING_TEXT_VERSION } from "../domain/embedding-text";
import type { CatalogDependencies } from "./ports";

export type EmbedCardsSummary = Readonly<{
  embedded: number;
  batches: number;
}>;

const DEFAULT_BATCH_SIZE = 64;

/** Embeds all oracle cards missing or with stale `(model, textVersion)` rows in `card_embeddings`. */
export function makeEmbedCards(dependencies: CatalogDependencies) {
  const { unitOfWork, textEmbedder, clock } = dependencies;

  async function embedCards(
    options: { limit?: number; batchSize?: number } = {},
  ): Promise<EmbedCardsSummary> {
    if (!textEmbedder) return { embedded: 0, batches: 0 };
    const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
    const missingResult = await unitOfWork.run(async (services) => {
      if (!services.embeddings) return ok([]);
      const rows = await services.embeddings.listMissingOrStale(
        EMBEDDING_MODEL,
        EMBEDDING_TEXT_VERSION,
        options.limit,
      );
      return ok(rows);
    });
    if (!missingResult.ok) return { embedded: 0, batches: 0 };
    const missing = missingResult.value;
    if (missing.length === 0) return { embedded: 0, batches: 0 };

    let embedded = 0;
    let batches = 0;
    for (let i = 0; i < missing.length; i += batchSize) {
      const slice = missing.slice(i, i + batchSize);
      const texts = slice.map((row) => cleanCardText(row.name, row.typeLine, row.text));
      const vectors = await textEmbedder(texts);
      const now = clock.now();
      const rows = slice.flatMap((row, idx) => {
        const embedding = vectors[idx];
        return embedding
          ? [
              {
                oracleId: row.oracleId,
                model: EMBEDDING_MODEL,
                textVersion: EMBEDDING_TEXT_VERSION,
                embedding,
                updatedAt: now,
              },
            ]
          : [];
      });
      await unitOfWork.run(async (services) => {
        await services.embeddings?.upsertBatch(rows);
        return ok(undefined);
      });
      embedded += rows.length;
      batches += 1;
    }
    return { embedded, batches };
  }

  return { embedCards };
}
