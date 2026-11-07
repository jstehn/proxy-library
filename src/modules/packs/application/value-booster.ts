import { expectedPackValue } from "../domain/odds";
import { printingsInSheets } from "../domain/pack";
import type { BoosterKey, PacksServices } from "./ports";

/**
 * The average market value of one booster, in cents (not rounded), from its recipe and today's
 * prices, inside the caller's transaction (design doc 27). Null when there's no recipe.
 */
export async function valueBooster(
  services: PacksServices,
  key: BoosterKey,
): Promise<number | null> {
  const config = await services.boosters.boosterConfig(key);
  if (config === null) return null;
  const facts = await services.boosters.printingFacts(printingsInSheets(config.sheets));
  return expectedPackValue(config, (printingId) => facts.get(printingId));
}
