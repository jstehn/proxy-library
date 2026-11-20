import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { CardFeatureStore } from "../application/ports";
import { cardTextsToCompute } from "../queries/card-texts";
import { cardFeatures } from "./schema";

/** Writes the features pass's results; the `cardFeatures` read is the reader. */
export function drizzleCardFeatureStore(db: DbExecutor): CardFeatureStore {
  return {
    textsToCompute: (version, limit) => cardTextsToCompute(db, version, limit),

    async save(rows, updatedAt) {
      if (rows.length === 0) return;
      await db
        .insert(cardFeatures)
        .values(
          rows.map((row) => ({
            oracleId: row.oracleId,
            features: row.features,
            featuresVersion: row.features.featuresVersion,
            roleTags: [...row.features.roleTags],
            themeTags: [...row.features.themes],
            leaderThemes: [...row.features.leaderThemes],
            bracketFlags: [...row.features.bracketFlags],
            landCycles: [...row.features.landCycles],
            updatedAt,
          })),
        )
        .onConflictDoUpdate({
          target: cardFeatures.oracleId,
          set: {
            features: sql`excluded.features`,
            featuresVersion: sql`excluded.features_version`,
            roleTags: sql`excluded.role_tags`,
            themeTags: sql`excluded.theme_tags`,
            leaderThemes: sql`excluded.leader_themes`,
            bracketFlags: sql`excluded.bracket_flags`,
            landCycles: sql`excluded.land_cycles`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    },
  };
}
