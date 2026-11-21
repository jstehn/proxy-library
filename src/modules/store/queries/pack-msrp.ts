import type { DbExecutor } from "@/shared/db";
import type { Cents } from "@/shared/kernel";
import { packPrice } from "./store-prices";

// Not a public read (not in `queries/index.ts`): the drafts module's catalog adapter prices a
// draft's packs with it, through the store's public API.

/** The store price of a single booster pack of this set and type, or null (a draft's packs). */
export async function packMsrp(
  db: DbExecutor,
  setCode: string,
  boosterType: string,
): Promise<Cents | null> {
  return (await packPrice(db, setCode, boosterType))?.price ?? null;
}
