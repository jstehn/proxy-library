import type { EdhrecCardItem, EdhrecCommanderData } from "@/modules/catalog";
import { err, ok, type Result, type UserId } from "@/shared/kernel";
import { isPlayed } from "../domain/boards";
import { isAvoidCard, type DeckPlan } from "../domain/deck-profile";
import type { DeckView } from "../domain/deck-view";
import type { DeckNotFound } from "../domain/errors";
import type { OwnedCardCheck } from "../domain/owned-card-check";

// EDHREC's popularity data for a commander, and a deck compared with it. Popularity is what
// people play, not what is good: nothing here ranks a card or says to cut it.

export type EdhrecOptions = Readonly<{ theme?: string; budget?: "budget" | "expensive" }>;

export type EdhrecUnavailable = Readonly<{ kind: "EdhrecUnavailable"; reason: string }>;
export type EdhrecNotFound = Readonly<{ kind: "EdhrecNotFound"; commander: string }>;
export type CommanderMissing = Readonly<{ kind: "CommanderMissing" }>;

export type EdhrecReaders = Readonly<{
  fetchCommander(commander: string, options: EdhrecOptions): Promise<EdhrecCommanderData | null>;
  deckView(userId: UserId, deckId: number): Promise<DeckView | null>;
  profile(userId: UserId, deckId: number): Promise<DeckPlan | null>;
  /** Which of these names the catalog has, and how many copies the player owns. */
  ownedChecks(userId: UserId, names: readonly string[]): Promise<readonly OwnedCardCheck[]>;
}>;

export type DeckCardOnEdhrec = Readonly<{
  name: string;
  inclusionPct: number;
  synergy: number;
  category: string;
}>;

export type EdhrecMissingCard = EdhrecCardItem & Readonly<{ inCatalog: boolean; owned: boolean }>;

export type EdhrecDeckComparison = Readonly<{
  data: EdhrecCommanderData;
  inDeckWithEdhrec: readonly DeckCardOnEdhrec[];
  highInclusionNotInDeck: readonly EdhrecMissingCard[];
  inDeckNotOnEdhrec: readonly Readonly<{ name: string; typeLine: string }>[];
  /** Popular cards left out because the deck's profile says to avoid them. */
  leftOutAvoid: readonly string[];
}>;

/** A name and its front face, lower-cased: how EDHREC and the catalog may spell a card. */
function keysOf(name: string): string[] {
  const lower = name.toLowerCase();
  const front = lower.split(" // ")[0];
  return front !== undefined && front !== lower ? [lower, front] : [lower];
}

export function makeEdhrecResearch(readers: EdhrecReaders) {
  async function fetchPage(
    commander: string,
    options: EdhrecOptions,
  ): Promise<Result<EdhrecCommanderData, EdhrecUnavailable | EdhrecNotFound>> {
    let data: EdhrecCommanderData | null;
    try {
      data = await readers.fetchCommander(commander, options);
    } catch (error) {
      return err({
        kind: "EdhrecUnavailable",
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
    return data === null ? err({ kind: "EdhrecNotFound", commander }) : ok(data);
  }

  /** What EDHREC has for a commander: themes, popular cards, the average list. */
  async function forCommander(
    input: Readonly<{ commander: string }> & EdhrecOptions,
  ): Promise<Result<EdhrecCommanderData, EdhrecUnavailable | EdhrecNotFound>> {
    return fetchPage(input.commander, { theme: input.theme, budget: input.budget });
  }

  /** The deck against EDHREC for its commander: shared cards, popular ones it lacks, its own. */
  async function compareDeck(
    input: Readonly<{ userId: UserId; deckId: number; theme?: string }>,
  ): Promise<
    Result<
      EdhrecDeckComparison,
      DeckNotFound | CommanderMissing | EdhrecUnavailable | EdhrecNotFound
    >
  > {
    const [view, profile] = await Promise.all([
      readers.deckView(input.userId, input.deckId),
      readers.profile(input.userId, input.deckId),
    ]);
    if (view === null) return err({ kind: "DeckNotFound" });
    const commander = view.lines.find((line) => line.board === "commander");
    if (commander === undefined) return err({ kind: "CommanderMissing" });

    const page = await fetchPage(commander.name, { theme: input.theme });
    if (!page.ok) return page;
    const data = page.value;

    const edhrecByName = new Map<string, EdhrecCardItem>();
    for (const card of data.cards) {
      for (const key of keysOf(card.name)) if (!edhrecByName.has(key)) edhrecByName.set(key, card);
    }
    // The full name wins over a front face another card shares.
    for (const card of data.cards) edhrecByName.set(card.name.toLowerCase(), card);

    const played = view.lines.filter((line) => isPlayed(line.board) && line.board !== "commander");
    const deckKeys = new Set(played.flatMap((line) => keysOf(line.name)));

    const inDeckWithEdhrec: DeckCardOnEdhrec[] = [];
    const inDeckNotOnEdhrec: { name: string; typeLine: string }[] = [];
    for (const line of played) {
      const match = keysOf(line.name)
        .map((key) => edhrecByName.get(key))
        .find((card) => card !== undefined);
      if (match !== undefined) {
        inDeckWithEdhrec.push({
          name: line.name,
          inclusionPct: match.inclusionPct,
          synergy: match.synergy,
          category: match.category,
        });
      } else if (!line.isBasicLand) {
        inDeckNotOnEdhrec.push({ name: line.name, typeLine: line.typeLine });
      }
    }

    const leftOutAvoid: string[] = [];
    const candidates = data.cards.filter((card) => {
      if (keysOf(card.name).some((key) => deckKeys.has(key))) return false;
      if (isAvoidCard(card.name, profile)) {
        leftOutAvoid.push(card.name);
        return false;
      }
      return true;
    });
    const popular = candidates.filter((card) => card.inclusionPct >= 20).slice(0, 60);
    const pool =
      popular.length > 0
        ? popular
        : [...candidates].sort((a, b) => b.inclusionPct - a.inclusionPct).slice(0, 30);

    const checks =
      pool.length > 0
        ? await readers.ownedChecks(
            input.userId,
            pool.map((card) => card.name),
          )
        : [];
    const checkByName = new Map(checks.map((check) => [check.query.toLowerCase(), check]));
    const highInclusionNotInDeck = pool
      .map((card): EdhrecMissingCard => {
        const check = checkByName.get(card.name.toLowerCase());
        return {
          ...card,
          inCatalog: check?.inCatalog ?? false,
          owned: check?.inCatalog === true ? check.ownedTotal > 0 : false,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return ok({
      data,
      inDeckWithEdhrec: inDeckWithEdhrec.sort((a, b) => a.name.localeCompare(b.name)),
      highInclusionNotInDeck,
      inDeckNotOnEdhrec: inDeckNotOnEdhrec.sort((a, b) => a.name.localeCompare(b.name)),
      leftOutAvoid: [...new Set(leftOutAvoid)].sort(),
    });
  }

  return { forCommander, compareDeck };
}
