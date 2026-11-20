import { catalogQueries, type TapMana } from "@/modules/catalog";
import type { DbExecutor } from "@/shared/db";

/**
 * The lines with what each card does when tapped for mana, from the catalog's card features
 * (design doc 66). The one place the decks' reads ask the catalog for features.
 */
export async function withTapMana<Line extends { oracleId: string }>(
  db: DbExecutor,
  lines: readonly Line[],
): Promise<Array<Line & { tapMana: TapMana }>> {
  const features = await catalogQueries.cardFeatures(
    db,
    lines.map((line) => line.oracleId),
  );
  return lines.map((line) => {
    const card = features.get(line.oracleId);
    if (card === undefined) throw new Error(`no card features for oracle card ${line.oracleId}`);
    return { ...line, tapMana: card.tapMana };
  });
}
