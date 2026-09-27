import type { BoosterConfig, Finish, PrintingId, SetCode } from "@/modules/catalog";
import { Cents } from "@/shared/kernel";
import { expectedPerPack, observedPerPack, type PerPackCounts } from "./odds";
import { marketValue, type FactsLookup, type Pack } from "./pack";

// The Pack lab's report on a batch of simulated openings (design doc 05, section 5).

export const SIMULATION_LIMIT = 1_000; // packs per run (decided in review)
export const BEST_PULLS_SHOWN = 10;
export const SAMPLE_PACKS_SHOWN = 3;

/** One valuable card seen in the simulation, and how many times it came up. */
export type Pull = Readonly<{
  printingId: PrintingId;
  finish: Finish;
  price: Cents;
  timesPulled: number;
}>;

export type SimulationReport = Readonly<{
  setCode: SetCode;
  boosterType: string;
  seed: string;
  packCount: number;
  expected: PerPackCounts; // per pack, calculated from the recipe
  observed: PerPackCounts; // per pack, averaged over the simulated packs
  /** Market value of the average pack's contents, rounded down to the cent. */
  averageValue: Cents;
  bestPulls: readonly Pull[];
  samplePacks: readonly Pack[];
}>;

/** The market value of everything in one pack. */
export function packValue(pack: Pack, facts: FactsLookup): Cents {
  return Cents.sum(pack.cards.map((card) => marketValue(card, facts)));
}

export function summarizeOpenings(input: {
  config: BoosterConfig;
  facts: FactsLookup;
  seed: string;
  packs: readonly Pack[];
}): SimulationReport {
  const { config, facts, seed, packs } = input;

  const totalValue = Cents.sum(packs.map((pack) => packValue(pack, facts)));
  const averageValue =
    packs.length === 0 ? Cents.zero : Cents.of(Math.floor(totalValue / packs.length));

  // Count each printing-and-finish once, then keep the most valuable.
  const pullsByCard = new Map<string, Pull>();
  for (const pack of packs) {
    for (const card of pack.cards) {
      const key = `${card.printingId}/${card.finish}`;
      const seen = pullsByCard.get(key);
      pullsByCard.set(key, {
        printingId: card.printingId,
        finish: card.finish,
        price: marketValue(card, facts),
        timesPulled: (seen?.timesPulled ?? 0) + 1,
      });
    }
  }
  const bestPulls = [...pullsByCard.values()]
    .filter((pull) => pull.price > 0)
    .sort((a, b) => b.price - a.price || b.timesPulled - a.timesPulled)
    .slice(0, BEST_PULLS_SHOWN);

  return {
    setCode: config.setCode,
    boosterType: config.boosterType,
    seed,
    packCount: packs.length,
    expected: expectedPerPack(config, facts),
    observed: observedPerPack(
      packs.map((pack) => pack.cards),
      facts,
    ),
    averageValue,
    bestPulls,
    samplePacks: packs.slice(0, SAMPLE_PACKS_SHOWN),
  };
}
