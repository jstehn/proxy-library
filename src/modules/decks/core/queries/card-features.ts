import { catalogQueries, type CardFeatures } from "@/modules/catalog";
import type { DbExecutor } from "@/shared/db";

export type FeaturesOf = (oracleId: string) => CardFeatures;

/**
 * The card features of these oracle cards (design doc 66): the one place the decks' reads ask the
 * catalog for them. Gives each card's features by oracle id.
 */
export async function cardFeaturesOf(
  db: DbExecutor,
  oracleIds: readonly string[],
): Promise<FeaturesOf> {
  const features = await catalogQueries.cardFeatures(db, oracleIds);
  return function featuresOf(oracleId) {
    const card = features.get(oracleId);
    if (card === undefined) throw new Error(`no card features for oracle card ${oracleId}`);
    return card;
  };
}

/** The lines with what their cards do when tapped and when played. */
export async function withFeatures<Line extends { oracleId: string }>(
  db: DbExecutor,
  lines: readonly Line[],
): Promise<Array<Line & Pick<CardFeatures, "tapMana" | "entersTapped" | "landFetch">>> {
  const featuresOf = await cardFeaturesOf(
    db,
    lines.map((line) => line.oracleId),
  );
  return lines.map((line) => {
    const { tapMana, entersTapped, landFetch } = featuresOf(line.oracleId);
    return { ...line, tapMana, entersTapped, landFetch };
  });
}
