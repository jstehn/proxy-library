import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { extractFeatures } from "../domain/features/registry";
import type { CardFeatures } from "../domain/features/types";
import { FEATURES_VERSION } from "../domain/features/version";
import { cardFeatures as cardFeaturesTable } from "../infrastructure/schema";
import { cardTextsOf } from "./card-texts";

/**
 * What these oracle cards do (design doc 66), keyed by oracle id: the stored features at the
 * current version. A card with no row yet (or an old one) is worked out on the spot from its
 * text, so a deploy that raises the version never serves empty features. The worker's
 * `pnpm worker sync features` stores them; a read does not write.
 */
export async function cardFeatures(
  db: DbExecutor,
  oracleIds: readonly string[],
): Promise<Map<string, CardFeatures>> {
  const unique = [...new Set(oracleIds)];
  const stored =
    unique.length === 0
      ? []
      : await db
          .select({ oracleId: cardFeaturesTable.oracleId, features: cardFeaturesTable.features })
          .from(cardFeaturesTable)
          .where(
            and(
              inArray(cardFeaturesTable.oracleId, unique),
              eq(cardFeaturesTable.featuresVersion, FEATURES_VERSION),
            ),
          );
  // Written by this module from `extractFeatures`, so its shape is known.
  const features = new Map(stored.map((row) => [row.oracleId, row.features as CardFeatures]));
  const missing = unique.filter((oracleId) => !features.has(oracleId));
  for (const text of await cardTextsOf(db, missing)) {
    features.set(text.oracleId, extractFeatures(text));
  }
  return features;
}
