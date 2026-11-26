import type { SpellbookCombo, SpellbookCombosResult } from "@/modules/catalog";
import { err, ok, type Result, type UserId } from "@/shared/kernel";
import { isPlayed } from "@/modules/decks/core/client";
import { declaredComboFor, type DeckPlan } from "@/modules/decks/core/client";
import type { DeckView } from "@/modules/decks/core/client";
import type { DeckNotFound } from "@/modules/decks/core/client";
import type { OwnedCardCheck } from "../domain/owned-card-check";

// The combos in a deck and the ones one card away, from Commander Spellbook (cached for a day).

export type SpellbookUnavailable = Readonly<{ kind: "SpellbookUnavailable"; reason: string }>;

export type DeckCombosReaders = Readonly<{
  fetchCombos(
    mainCards: readonly string[],
    commanders: readonly string[],
  ): Promise<SpellbookCombosResult>;
  deckView(userId: UserId, deckId: number): Promise<DeckView | null>;
  profile(userId: UserId, deckId: number): Promise<DeckPlan | null>;
  ownedChecks(userId: UserId, names: readonly string[]): Promise<readonly OwnedCardCheck[]>;
}>;

export type CombosRequest = Readonly<{
  userId: UserId;
  deckId: number;
  /** Count cards on the maybeboard too. */
  includeMaybe: boolean;
  /** Only return one-card-away combos whose missing piece you already own. */
  ownedOnly?: boolean;
  /** Only combos Spellbook tags with this bracket letter. */
  bracket?: string;
  limit: number;
  offset: number;
}>;

/** A combo the deck has: all its pieces are played, or some are on the maybeboard. */
export type DeckComboFound = SpellbookCombo &
  Readonly<{
    status: "complete" | "needsMaybe";
    maybePieces?: readonly string[];
    declared?: string;
  }>;

export type MissingPiece = Readonly<{
  name: string;
  inCatalog: boolean;
  owned: boolean;
  ownedTotal: number;
  cheapestPriceCents: number | null;
}>;

export type ComboOneAway = SpellbookCombo &
  Readonly<{
    missingPiece: MissingPiece;
    /** Existing pieces of this combo that currently sit on the maybeboard (omitted if all are in main/commander). */
    maybePieces?: readonly string[];
  }>;

export type DeckCombos = Readonly<{
  source: Pick<SpellbookCombosResult, "sourceUrl" | "fetchedAt" | "cached">;
  totalComplete: number;
  totalNeedsMaybe: number;
  declaredCombos: readonly string[];
  /** Which declared combos Spellbook found, and how many found ones weren't declared. */
  declarations: readonly Readonly<{ declared: string; foundBySpellbook: boolean }>[];
  undeclaredComplete: number;
  totalOneAway: number;
  offset: number;
  limit: number;
  complete: readonly DeckComboFound[];
  oneAway: readonly ComboOneAway[];
}>;

export function makeDeckCombos(readers: DeckCombosReaders) {
  async function combosForDeck(
    request: CombosRequest,
  ): Promise<Result<DeckCombos, DeckNotFound | SpellbookUnavailable>> {
    const { userId, deckId } = request;
    const view = await readers.deckView(userId, deckId);
    if (view === null) return err({ kind: "DeckNotFound" });

    const commanders = view.lines.filter((l) => l.board === "commander").map((l) => l.name);
    const playedNames = new Set(
      view.lines
        .filter((l) => l.board === "commander" || isPlayed(l.board))
        .map((l) => l.name.toLowerCase()),
    );
    const maybeNames = new Set(
      view.lines.filter((l) => l.board === "maybe").map((l) => l.name.toLowerCase()),
    );
    const mainCards = view.lines
      .filter(
        (l) =>
          l.board !== "commander" &&
          (isPlayed(l.board) || (request.includeMaybe && l.board === "maybe")),
      )
      .map((l) => l.name);

    let spellbook: SpellbookCombosResult;
    try {
      spellbook = await readers.fetchCombos(mainCards, commanders);
    } catch (error) {
      return err({
        kind: "SpellbookUnavailable",
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }

    const wanted = request.bracket?.toUpperCase();
    const matchesBracket = (tag: string | null | undefined) =>
      !wanted || (tag ?? "").toUpperCase() === wanted;

    const declaredCombos = (await readers.profile(userId, deckId))?.declaredCombos ?? [];
    const found = spellbook.complete
      .filter((combo) => matchesBracket(combo.bracketTag))
      .map((combo): DeckComboFound => {
        const maybePieces = combo.uses.filter(
          (name) => !playedNames.has(name.toLowerCase()) && maybeNames.has(name.toLowerCase()),
        );
        const declared = declaredComboFor(combo, declaredCombos);
        return {
          ...combo,
          status: maybePieces.length > 0 ? "needsMaybe" : "complete",
          ...(maybePieces.length > 0 ? { maybePieces } : {}),
          ...(declared !== null ? { declared } : {}),
        };
      });
    const foundDeclarations = new Set(found.flatMap((combo) => combo.declared ?? []));

    const matchingOneAway = spellbook.oneCardAway.filter((combo) =>
      matchesBracket(combo.bracketTag),
    );
    const allMissingNames = [...new Set(matchingOneAway.map((combo) => combo.missingCardName))];
    const checks: OwnedCardCheck[] = [];
    for (let index = 0; index < allMissingNames.length; index += 100) {
      const batch = allMissingNames.slice(index, index + 100);
      checks.push(...(await readers.ownedChecks(userId, batch)));
    }
    const checkByName = new Map(checks.map((check) => [check.query.toLowerCase(), check]));

    const enrichedOneAway = matchingOneAway
      .map((combo): ComboOneAway => {
        const check = checkByName.get(combo.missingCardName.toLowerCase());
        const { missingCardName, ...piece } = combo;
        const maybePieces = combo.uses.filter(
          (name) =>
            name.toLowerCase() !== missingCardName.toLowerCase() &&
            !playedNames.has(name.toLowerCase()) &&
            maybeNames.has(name.toLowerCase()),
        );
        return {
          ...piece,
          ...(maybePieces.length > 0 ? { maybePieces } : {}),
          missingPiece:
            check?.inCatalog === true
              ? {
                  name: check.name,
                  inCatalog: true,
                  owned: check.ownedTotal > 0,
                  ownedTotal: check.ownedTotal,
                  cheapestPriceCents: check.cheapestPriceCents,
                }
              : {
                  name: missingCardName,
                  inCatalog: false,
                  owned: false,
                  ownedTotal: 0,
                  cheapestPriceCents: null,
                },
        };
      })
      .filter((combo) => request.ownedOnly !== true || combo.missingPiece.owned)
      // Surface combos whose missing piece the player already owns first, keeping Spellbook order within each group.
      .sort((a, b) => Number(b.missingPiece.owned) - Number(a.missingPiece.owned));

    const page = { from: request.offset, to: request.offset + request.limit };
    const pagedOneAway = enrichedOneAway.slice(page.from, page.to);

    return ok({
      source: {
        sourceUrl: spellbook.sourceUrl,
        fetchedAt: spellbook.fetchedAt,
        cached: spellbook.cached,
      },
      totalComplete: found.filter((combo) => combo.status === "complete").length,
      totalNeedsMaybe: found.filter((combo) => combo.status === "needsMaybe").length,
      declaredCombos,
      declarations: declaredCombos.map((declared) => ({
        declared,
        foundBySpellbook: foundDeclarations.has(declared),
      })),
      undeclaredComplete: found.filter(
        (combo) => combo.status === "complete" && combo.declared === undefined,
      ).length,
      totalOneAway: enrichedOneAway.length,
      offset: request.offset,
      limit: request.limit,
      complete: found.slice(page.from, page.to),
      oneAway: pagedOneAway,
    });
  }

  return { combosForDeck };
}
