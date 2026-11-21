import { invalidCommanders, pairProblem, preconCommanders } from "@/modules/decks";
import { productProblems } from "@/modules/inventory";
import { loadProductCheck } from "@/modules/inventory/infrastructure";
import type { Command } from "./command";

/**
 * `pnpm worker check-packs [packs]`: open that many packs (default 1,000) of every booster
 * recipe in the catalog and report anything that breaks the recipe's rules (design doc 05).
 */
export const checkPacks: Command = async (container) => {
  const packsPerBooster = Number(process.argv[3] ?? 1_000);
  if (!Number.isInteger(packsPerBooster) || packsPerBooster < 1) {
    throw new Error(`packs must be a positive whole number, got ${process.argv[3]}`);
  }
  console.log(`opening ${packsPerBooster} packs of every booster recipe…`);
  const checks = await container.packs.checkBoosters(packsPerBooster);
  const withProblems = checks.filter((check) => check.problems.length > 0);
  for (const check of withProblems) {
    console.log(`\n${check.setCode} ${check.boosterType}:`);
    for (const { problem, packs } of check.problems) {
      console.log(`  ${problem} (in ${packs} of ${check.packsOpened} packs)`);
    }
  }
  const opened = checks.reduce((total, check) => total + check.packsOpened, 0);
  console.log(
    `\n${checks.length} recipes, ${opened} packs opened, ${withProblems.length} recipe(s) with problems`,
  );
  if (withProblems.length > 0) process.exitCode = 1;
};

/**
 * `pnpm worker check-products`: every product in an enabled set must open into something, and
 * everything it names must exist (design doc 11, section 5; the empty-precon bug).
 */
export const checkProducts: Command = async (container) => {
  const { toCheck, knowledge } = await loadProductCheck(container.db);
  let bad = 0;
  for (const product of toCheck) {
    const problems = productProblems(product.contents, knowledge);
    if (problems.length === 0) continue;
    bad += 1;
    console.log(`\n${product.setCode} ${product.name}:`);
    for (const problem of problems.slice(0, 5)) console.log(`  ${problem}`);
  }
  console.log(`\n${toCheck.length} products checked, ${bad} with problems`);
  if (bad > 0) process.exitCode = 1;
};

/**
 * `pnpm worker check-commanders`: every precon's commanders must be allowed to lead a deck. A
 * precon always has a valid commander, so any failure is a gap in our rule (Hearthhull, the
 * Worldseed found the 2025 Spacecraft rule).
 */
export const checkCommanders: Command = async (container) => {
  const decks = await preconCommanders(container.db);
  let bad = 0;
  for (const deck of decks) {
    const invalid = invalidCommanders(deck.commanders);
    // Two commanders must also pair (design doc 40).
    const pairing = pairProblem(deck.commanders);
    if (invalid.length === 0 && pairing === null) continue;
    bad += 1;
    if (invalid.length > 0) {
      console.log(`${deck.setCode} ${deck.deckName}: rejected ${invalid.join(", ")}`);
    }
    if (pairing?.kind === "CommandersCantPair") {
      console.log(`${deck.setCode} ${deck.deckName}: can't pair ${pairing.names.join(" + ")}`);
    }
  }
  console.log(`\n${decks.length} precon decks checked, ${bad} with a rejected commander`);
  if (bad > 0) process.exitCode = 1;
};
