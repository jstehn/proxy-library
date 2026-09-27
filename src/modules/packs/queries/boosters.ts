import { asc, desc, eq } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { boosterConfigs, cardSets } from "@/modules/catalog/infrastructure/schema";

// Read models for the Pack lab's pickers (ADR 0006).

export type BoosterChoice = Readonly<{
  setCode: string;
  setName: string;
  keyruneCode: string;
  boosterTypes: string[];
}>;

/** Every enabled set that has booster recipes, newest first, with its booster types. */
export async function availableBoosters(db: DbExecutor): Promise<BoosterChoice[]> {
  const rows = await db
    .select({
      setCode: cardSets.code,
      setName: cardSets.name,
      keyruneCode: cardSets.keyruneCode,
      boosterType: boosterConfigs.boosterType,
    })
    .from(boosterConfigs)
    .innerJoin(cardSets, eq(cardSets.code, boosterConfigs.setCode))
    .where(eq(cardSets.isEnabled, true))
    .orderBy(desc(cardSets.releaseDate), asc(cardSets.code), asc(boosterConfigs.boosterType));

  const choices = new Map<string, BoosterChoice>();
  for (const row of rows) {
    const choice = choices.get(row.setCode) ?? {
      setCode: row.setCode,
      setName: row.setName,
      keyruneCode: row.keyruneCode,
      boosterTypes: [],
    };
    choice.boosterTypes.push(row.boosterType);
    choices.set(row.setCode, choice);
  }
  return [...choices.values()];
}
