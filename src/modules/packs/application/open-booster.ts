import type { BoosterConfig } from "@/modules/catalog";
import { err, ok, type Result } from "@/shared/kernel";
import type { BoosterUnavailable } from "../domain/errors";
import { openPack } from "../domain/generate";
import { factsLookup, printingsInSheets, type FactsLookup, type Pack } from "../domain/pack";
import type { BoosterKey, PacksServices } from "./ports";

/** A recipe together with the facts about every card it can produce: all the engine needs. */
export type LoadedBooster = Readonly<{ config: BoosterConfig; facts: FactsLookup }>;

/** Loads a recipe and its printings' facts (two queries), or null if there's no such booster. */
export async function loadBooster(
  services: PacksServices,
  key: BoosterKey,
): Promise<LoadedBooster | null> {
  const config = await services.boosters.boosterConfig(key);
  if (config === null) return null;
  const facts = await services.boosters.printingFacts(printingsInSheets(config.sheets));
  return { config, facts: factsLookup(facts) };
}

export type OpenBoosterInput = BoosterKey & Readonly<{ seed: string }>;

/**
 * Opens one booster, inside the caller's transaction (design doc 05, section 5). Phase 6's
 * "open a pack" calls this with a fresh seed and stores the seed and the cards it returns.
 */
export async function openBooster(
  services: PacksServices,
  input: OpenBoosterInput,
): Promise<Result<Pack, BoosterUnavailable>> {
  const booster = await loadBooster(services, input);
  if (booster === null) return err({ kind: "BoosterUnavailable" });
  return ok(openPack(booster.config, booster.facts, input.seed));
}
