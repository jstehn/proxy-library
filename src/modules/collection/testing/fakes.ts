import { PrintingId, type Finish } from "@/modules/catalog";
import type { UserId } from "@/shared/kernel";
import type { CollectionRepository } from "../application/ports";
import type { Acquisition, CardGain } from "../domain/cards";

/** A gain for tests: `sampleGain("a", 2)` is two nonfoil copies of printing "a". */
export function sampleGain(
  printingId: string,
  quantity: number,
  finish: Finish = "nonfoil",
): CardGain {
  return { printingId: PrintingId.of(printingId), finish, quantity };
}

export type LoggedAcquisition = Acquisition & { userId: UserId; gains: readonly CardGain[] };

/** The collection in memory. `quantity` and `log` are for test assertions. */
export function inMemoryCollectionRepository() {
  const quantities = new Map<string, number>();
  const log: LoggedAcquisition[] = [];

  const repository: CollectionRepository = {
    async receive(userId, gains, acquisition) {
      for (const gain of gains) {
        const key = `${userId}/${gain.printingId}/${gain.finish}`;
        quantities.set(key, (quantities.get(key) ?? 0) + gain.quantity);
      }
      log.push({ ...acquisition, userId, gains });
    },
  };

  return {
    ...repository,
    quantity(userId: UserId, printingId: string, finish: Finish = "nonfoil"): number {
      return quantities.get(`${userId}/${printingId}/${finish}`) ?? 0;
    },
    log,
  };
}
