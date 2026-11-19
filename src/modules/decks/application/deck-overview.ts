import { formatRules } from "../domain/format-rules";
import type { PrintingCard } from "@/modules/catalog";
import { err, ok, type Result, type UserId } from "@/shared/kernel";
import type { DeckCombo } from "../domain/brackets";
import type { Board } from "../domain/deck";
import { isPlayed } from "../domain/boards";
import { bracketReport, listAndFingerprint, problemsOfLines } from "../domain/deck-reads";
import type { DeckSource, DeckView, StoredDeckProfile } from "../domain/deck-view";
import { library, openingHandOdds, type OpeningHandOdds } from "../domain/draws";
import type { DeckNotFound } from "../domain/errors";
import type { DeckProblem } from "../domain/rules";
import { deckStats, type DeckStats } from "../domain/stats";
import type { TokenLine } from "../domain/token-proxies";
import type { BracketReport } from "../domain/deck-reads";

// One deck, read once (ADR 0026, audit F2). The builder, the deck page and the get_deck tool all
// ask for the deck here, so they agree on its problems, its bracket and its list. What costs a
// query (card art, tokens, sources, the profile) is read only when `with` asks for it.

/** What a deck line needs to make a token: the part of a line the token reader looks at. */
export type TokenMaker = Readonly<{
  oracleId: string;
  printingId: string;
  name: string;
  board: Board;
}>;

export type DeckOverviewReaders = Readonly<{
  /** The player's deck with its lines, or null when it isn't theirs. */
  deckView(userId: UserId, deckId: number): Promise<DeckView | null>;
  /** The deck's two-card combos from Commander Spellbook; undefined when they aren't synced. */
  combosFor(oracleIds: readonly string[]): Promise<readonly DeckCombo[] | undefined>;
  /** Card art and faces by printing id, for the builder. */
  printingCards(printingIds: readonly string[]): Promise<ReadonlyMap<string, PrintingCard>>;
  tokenLines(deckId: number, makers: readonly TokenMaker[]): Promise<TokenLine[]>;
  sources(userId: UserId, deckId: number): Promise<DeckSource[] | null>;
  profile(userId: UserId, deckId: number): Promise<StoredDeckProfile | null>;
}>;

/** The parts of the overview that cost a query or a simulation; each is off unless asked for. */
export type OverviewParts = Readonly<{
  printings?: boolean;
  tokens?: boolean;
  sources?: boolean;
  profile?: boolean;
  /** Opening-hand odds (pure; no query). */
  odds?: boolean;
}>;

export type DeckOverview = Readonly<{
  view: DeckView;
  stats: DeckStats;
  problems: readonly DeckProblem[];
  /** The Commander bracket estimate; null outside Commander. */
  bracket: BracketReport | null;
  /** Two-card combos (Commander only; undefined when not synced). */
  combos: readonly DeckCombo[] | undefined;
  list: string;
  fingerprint: string;
  printings?: ReadonlyMap<string, PrintingCard>;
  tokens?: readonly TokenLine[];
  sources?: readonly DeckSource[];
  /** The stored profile, or null when the deck has none. */
  profile?: StoredDeckProfile | null;
  /** Null when the main deck is empty. */
  odds?: OpeningHandOdds | null;
}>;

export type DeckOverviewRequest = Readonly<{
  userId: UserId;
  deckId: number;
  parts?: OverviewParts;
}>;

export function makeDeckOverview(readers: DeckOverviewReaders) {
  async function deckOverview(
    request: DeckOverviewRequest,
  ): Promise<Result<DeckOverview, DeckNotFound>> {
    const { userId, deckId } = request;
    const parts = request.parts ?? {};
    const view = await readers.deckView(userId, deckId);
    if (view === null) return err({ kind: "DeckNotFound" });

    const makers = view.lines.map((line) => ({
      oracleId: line.oracleId,
      printingId: line.printingId,
      name: line.name,
      board: line.board,
    }));
    const [combos, printings, tokens, sources, profile] = await Promise.all([
      formatRules(view.deck.format).bracketsApply
        ? readers.combosFor(
            view.lines.filter((line) => isPlayed(line.board)).map((line) => line.oracleId),
          )
        : Promise.resolve(undefined),
      parts.printings
        ? readers.printingCards(view.lines.map((line) => line.printingId))
        : Promise.resolve(undefined),
      parts.tokens ? readers.tokenLines(deckId, makers) : Promise.resolve(undefined),
      parts.sources ? readers.sources(userId, deckId) : Promise.resolve(undefined),
      parts.profile ? readers.profile(userId, deckId) : Promise.resolve(undefined),
    ]);

    return ok({
      view,
      stats: deckStats(view.lines),
      problems: problemsOfLines(view.deck.format, view.lines, view.rules),
      bracket: bracketReport(view, combos),
      combos,
      ...listAndFingerprint(view),
      ...(printings !== undefined ? { printings } : {}),
      ...(tokens !== undefined ? { tokens } : {}),
      ...(sources !== undefined ? { sources: sources ?? [] } : {}),
      ...(profile !== undefined ? { profile } : {}),
      ...(parts.odds
        ? {
            odds: openingHandOdds(library(view.lines), {
              onTheDraw: false,
              freeMulligan: formatRules(view.deck.format).freeFirstMulligan,
            }),
          }
        : {}),
    });
  }
  return deckOverview;
}
