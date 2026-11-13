import { cardTags } from "@/shared/card-search";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { isPlayed } from "../domain/boards";
import { rankCuts } from "../domain/cuts";
import type { Deck } from "../domain/deck";
import {
  buildUpgradeRoadmap,
  type UpgradeCandidate,
  type UpgradeCut,
  type UpgradeRoadmap,
} from "../domain/upgrade-roadmap";
import { deckView } from "./decks";
import { lineToOptimizerCard, suggestionToOptimizerCard } from "./optimize";
import { deckSuggestions } from "./suggestions";

export type UpgradeRoadmapResult = Readonly<{
  deck: Deck;
  roadmap: UpgradeRoadmap;
  hiddenOverTarget: number;
}>;

export type UpgradeRoadmapOptions = Readonly<{
  tiersCents?: readonly number[];
  maxSwapsPerTier?: number;
}>;

/**
 * Generates a tiered cut/add upgrade roadmap for a player's deck using `rankCuts`
 * and bracket-compliant store suggestions (`deckSuggestions`).
 */
export async function deckUpgradeRoadmap(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  options: UpgradeRoadmapOptions = {},
): Promise<UpgradeRoadmapResult | null> {
  const [view, suggestions] = await Promise.all([
    deckView(db, userId, deckId),
    deckSuggestions(db, userId, deckId),
  ]);
  if (view === null || suggestions === null) return null;

  const playedLines = view.lines.filter((line) => isPlayed(line.board));
  const currentDeck = playedLines.map(lineToOptimizerCard);

  const rankedCuts = rankCuts(
    playedLines.map((line) => ({
      oracleId: line.oracleId,
      name: line.name,
      board: line.board,
      quantity: line.quantity,
      typeLine: line.typeLine,
      manaValue: line.manaValue,
      text: line.text,
      keywords: line.keywords,
      producedMana: line.producedMana,
      priceCents: line.priceCents,
      rarity: line.rarity,
      isGameChanger: line.isGameChanger,
      owned: line.owned,
      edhrec: line.edhrec,
    })),
    { format: view.deck.format, targetBracket: view.deck.targetBracket },
  );

  const lineById = new Map(playedLines.map((l) => [l.oracleId, l]));
  const cuts: UpgradeCut[] = rankedCuts.map((cut) => {
    const line = lineById.get(cut.oracleId);
    return {
      oracleId: cut.oracleId,
      name: cut.name,
      keepScore: cut.keepScore,
      manaValue: line?.manaValue ?? 0,
      roles: cardTags({
        typeLine: line?.typeLine ?? "",
        text: line?.text ?? "",
        producedMana: line?.producedMana ?? [],
      }),
    };
  });

  const storeById = new Map(
    [...suggestions.forDeck.store, ...suggestions.forRoles.flatMap((r) => r.store)].map((s) => [
      s.card.oracleId,
      s,
    ]),
  );
  const candidates: UpgradeCandidate[] = [...storeById.values()]
    .filter((s) => s.card.priceCents !== null && s.card.priceCents >= 0)
    .map((s) => ({
      card: suggestionToOptimizerCard(s),
      rating: s.rating,
      reasons: s.reasons.map((r) => String(r.kind)),
      priceCents: s.card.priceCents ?? 0,
    }));

  const roadmap = buildUpgradeRoadmap({
    format: view.deck.format,
    targetBracket: view.deck.targetBracket,
    currentDeck,
    cuts,
    candidates,
    tiersCents: options.tiersCents,
    maxSwapsPerTier: options.maxSwapsPerTier,
  });

  return {
    deck: view.deck,
    roadmap,
    hiddenOverTarget: suggestions.forDeck.hiddenOverTarget,
  };
}
