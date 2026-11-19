import {
  formatRulesSummary,
  legalFormatsForCards,
  resolveDeckProfileTargets,
  roleTargets,
  shortList,
  summarizeDeckProfile,
  summarizeTokenChecklist,
  toTokenChecklistItem,
  type DeckOverview,
} from "@/modules/decks";
import { problemText } from "@/app/decks/labels";
import { isBasicLand } from "@/shared/kernel";
import { money, moneyOrNull } from "../tool";

import { bracketView, type PresentInput } from "./get-deck-input";

// What get_deck says (design doc 61, section 5a); these functions only reshape what the
// capabilities answered, and never query.

/** get_deck's older shape: an object per line, every section (view: "full"). */
export function fullDeckPayload(
  overview: DeckOverview,
  input: PresentInput,
): Record<string, unknown> {
  const { view, stats, list, fingerprint: print } = overview;
  const problems = [...overview.problems];
  const handOdds = overview.odds ?? null;
  const toPercent = (probability: number) => Math.round(probability * 1000) / 10;
  const rawTokens = [...(overview.tokens ?? [])];
  const deckSources = overview.sources;
  const storedProfile = overview.profile;
  const checklist = rawTokens.map(toTokenChecklistItem);
  const missingCards = problems.flatMap((problem) => {
    if (problem.kind !== "Short") return [];
    const missing = Math.max(0, problem.needed - problem.owned);
    const line =
      view.lines.find((l) => l.oracleId === problem.oracleId && l.board !== "maybe") ??
      view.lines.find((l) => l.oracleId === problem.oracleId);
    const priceCents = line?.priceCents ?? null;
    const subtotalCents = priceCents === null ? null : missing * priceCents;
    return [
      {
        name: problem.name,
        oracleId: problem.oracleId,
        needed: problem.needed,
        owned: problem.owned,
        missing,
        price: moneyOrNull(priceCents),
        subtotal: moneyOrNull(subtotalCents),
        subtotalCents,
      },
    ];
  });
  const missingCopies = missingCards.reduce((sum, c) => sum + c.missing, 0);
  const missingTotalCents = missingCards.reduce((sum, c) => sum + (c.subtotalCents ?? 0), 0);
  const unpricedCount = missingCards.filter((c) => c.subtotalCents === null).length;
  const maybeboardCards = view.lines
    .filter((l) => l.board === "maybe")
    .map((l) => {
      const isBasic = isBasicLand(l.typeLine);
      const missing = isBasic ? 0 : Math.max(0, l.quantity - l.owned);
      const subtotalCents = missing > 0 && l.priceCents !== null ? missing * l.priceCents : null;
      return {
        name: l.name,
        oracleId: l.oracleId,
        quantity: l.quantity,
        owned: l.owned,
        ...(l.ownedReal > 0 ? { ownedReal: l.ownedReal } : {}),
        missing,
        price: moneyOrNull(l.priceCents),
        ...(subtotalCents !== null ? { subtotal: money(subtotalCents) } : {}),
      };
    });

  const filteredLines = view.lines.filter((line) => {
    if (input.boards && input.boards.length > 0 && !input.boards.includes(line.board)) {
      return false;
    }
    return true;
  });

  const profileSummary = summarizeDeckProfile(storedProfile?.profile);
  const fullPayload: Record<string, unknown> = {
    ...(profileSummary !== null ? { profileSummary } : {}),
    deck: {
      id: view.deck.id,
      name: view.deck.name,
      format: view.deck.format,
      usesRealCards: view.deck.usesRealCards,
      grouping: view.deck.grouping,
      headings: view.deck.headings,
    },
    fingerprint: print,
    lines: filteredLines.map((line) => ({
      name: line.name,
      oracleId: line.oracleId,
      printingId: line.printingId,
      board: line.board,
      quantity: line.quantity,
      ...(line.heading !== null ? { heading: line.heading } : {}),
      ...(line.note !== null ? { note: line.note } : {}),
      tags: line.tags ?? [],
      owned: line.owned,
      ...(line.ownedReal > 0 ? { ownedReal: line.ownedReal } : {}),
      ...(line.otherDecks.length > 0
        ? {
            free: line.free,
            ...(input.include.includes("owners")
              ? {
                  otherDecks: line.otherDecks.map((use) => ({
                    deckId: use.deckId,
                    name: use.name,
                    quantity: use.quantity,
                  })),
                }
              : {}),
          }
        : {}),
      manaCost: line.manaCost,
      manaValue: line.manaValue,
      typeLine: line.typeLine,
      ...(line.isGameChanger ? { isGameChanger: true } : {}),
      ...(input.includeText ? { text: line.text } : {}),
      price: moneyOrNull(line.priceCents),
    })),
    stats: {
      cardCount: stats.cardCount,
      sideboardCount: stats.sideboardCount,
      lands: stats.lands,
      otherManaSources: stats.otherManaSources,
      averageManaValue: Math.round(stats.averageManaValue * 100) / 100,
      curve: stats.curve,
      types: stats.types,
      pips: stats.pips,
      sources: stats.sources,
      roles: stats.tags,
      value: money(stats.priceCents),
      costToComplete: money(missingTotalCents),
    },
    formatRules: formatRulesSummary(view.deck.format),
    cardLegalIn:
      view.deck.format !== "commander" && view.deck.format !== "limited"
        ? legalFormatsForCards(view.deck, (oracleId) => view.rules[oracleId])
        : null,
    roleTargets: roleTargets(view.deck.format),
    problems: problems.map(problemText),
    bracket: bracketView(overview.bracket),
    openingHandOdds:
      handOdds === null
        ? null
        : {
            librarySize: handOdds.librarySize,
            lands: handOdds.lands,
            earlyRamp: handOdds.earlyRamp,
            playableLandsInOpening7Percent: toPercent(handOdds.opening.playableLands),
            playableAfterFirstMulliganPercent: toPercent(
              handOdds.opening.playableAfterFirstMulligan,
            ),
            threeLandsByTurn3Percent: toPercent(handOdds.landDrops[2].chance),
            fourLandsByTurn4Percent: toPercent(handOdds.landDrops[3].chance),
            earlyRampByTurn3Percent: toPercent(handOdds.rampByTurn3.atLeastOneEarlyRamp),
            twoLandsAndEarlyRampByTurn3Percent: toPercent(
              handOdds.rampByTurn3.twoLandsAndEarlyRamp,
            ),
          },
    tokens: {
      summary: summarizeTokenChecklist(rawTokens),
      items: checklist.map((item) => ({
        name: item.name,
        kind: item.kind,
        description: item.description,
        madeBy: item.madeBy,
        sideboardOnly: item.sideboardOnly,
      })),
    },
    list,
    shortList: shortList(problems, view.lines),
    toComplete: {
      missingCopies,
      total: money(missingTotalCents),
      ...(unpricedCount > 0 ? { unpricedCount } : {}),
      cards: missingCards.map((c) => ({
        name: c.name,
        oracleId: c.oracleId,
        needed: c.needed,
        owned: c.owned,
        missing: c.missing,
        price: c.price,
        subtotal: c.subtotal,
      })),
      ...(maybeboardCards.length > 0 ? { maybeboard: maybeboardCards } : {}),
    },
    deckSources: deckSources ?? [],
  };
  const profile = overview.profile?.profile;
  const baseTargets = roleTargets(view.deck.format);
  if (profile && baseTargets !== null) {
    fullPayload.roleTargets =
      resolveDeckProfileTargets(profile, null, { landTarget: 37, roleTargets: baseTargets })
        ?.roleTargets ?? baseTargets;
  }
  return fullPayload;
}
