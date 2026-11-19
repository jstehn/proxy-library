import { err, ok, type Result } from "@/shared/kernel";
import type { ScryfallRuling, ScryfallRulingsResult } from "../domain/outside-data";
import {
  findRuleInteractions,
  findSharedRules,
  matchRelatedRules,
  type RelatedRuleMatch,
  type RuleInteractionMatch,
} from "../domain/related-rules";
import type { LookupRulesResult } from "../domain/rules-search";

// What the rules say about cards (Scryfall rulings and the Comprehensive Rules sections their
// texts mention) and about rules themselves. A lookup, not a verdict.

/** The part of a card the rules lookups read. */
export type RulesCard = Readonly<{ name: string; scryfallId: string; text: string | null }>;

export type RulesLookupReaders = Readonly<{
  /** The card for a name, an oracle id or a printing id; null when the catalog lacks it. */
  findCard(query: string): Promise<RulesCard | null>;
  /** Scryfall's rulings for a card (cached for a day); null when Scryfall has none. */
  fetchRulings(target: {
    name: string;
    scryfallId?: string;
  }): Promise<ScryfallRulingsResult | null>;
  /** The Comprehensive Rules, by rule number or by meaning. */
  searchRules(query: string, limit: number): Promise<LookupRulesResult>;
}>;

/** One card's rulings: what was found, or why not. */
export type CardRulings =
  | Readonly<{ query: string; found: false; rulings: readonly []; error?: string }>
  | Readonly<{
      query: string;
      found: true;
      name: string;
      sourceUrl: string;
      fetchedAt: string;
      cached: boolean;
      rulings: readonly ScryfallRuling[];
      relatedRules?: readonly RelatedRuleMatch[];
    }>;

export type CardInteractionEntry = Readonly<{
  query: string;
  found: boolean;
  name: string;
  relatedRules: readonly RelatedRuleMatch[];
  rulings: readonly ScryfallRuling[];
}>;

export type CardInteractions = Readonly<{
  cards: readonly CardInteractionEntry[];
  sharedRules: ReturnType<typeof findSharedRules>;
  ruleInteractions: readonly RuleInteractionMatch[];
}>;

export type RulesCardNotFound = Readonly<{ kind: "CardNotFound"; query: string }>;

export function makeRulesLookup(readers: RulesLookupReaders) {
  /** Scryfall's rulings for one card, and the rules sections its text mentions. */
  async function rulingsOf(query: string, found: RulesCard | null): Promise<CardRulings> {
    try {
      const fetched = await readers.fetchRulings(
        found ? { name: found.name, scryfallId: found.scryfallId } : { name: query },
      );
      if (fetched === null) return { query, found: false, rulings: [] };
      return {
        query,
        found: true,
        name: fetched.name,
        sourceUrl: fetched.sourceUrl,
        fetchedAt: fetched.fetchedAt,
        cached: fetched.cached,
        rulings: fetched.rulings,
        ...(found ? { relatedRules: matchRelatedRules(found.text) } : {}),
      };
    } catch (error) {
      return {
        query,
        found: false,
        error: error instanceof Error ? error.message : "Failed to fetch rulings.",
        rulings: [],
      };
    }
  }

  /** The rulings for one card; the card must be in the catalog. */
  async function rulingsForCard(query: string): Promise<Result<CardRulings, RulesCardNotFound>> {
    const found = await readers.findCard(query);
    if (found === null) return err({ kind: "CardNotFound", query });
    return ok(await rulingsOf(found.name, found));
  }

  /** Each card's rulings and shared Comprehensive Rules sections, and how those rules interact. */
  async function interactionsOf(queries: readonly string[]): Promise<CardInteractions> {
    const cards = await Promise.all(
      queries.map(async (query): Promise<CardInteractionEntry> => {
        const found = await readers.findCard(query);
        let rulings: readonly ScryfallRuling[] = [];
        try {
          const fetched = await readers.fetchRulings(
            found ? { name: found.name, scryfallId: found.scryfallId } : { name: query },
          );
          if (fetched) rulings = [...fetched.rulings];
        } catch {
          // Not fatal: the related rules are still worth returning without the rulings.
        }
        return {
          query,
          found: found !== null,
          name: found?.name ?? query,
          relatedRules: found ? matchRelatedRules(found.text) : [],
          rulings,
        };
      }),
    );
    return {
      cards,
      sharedRules: findSharedRules(cards),
      ruleInteractions: findRuleInteractions(cards),
    };
  }

  /** The Comprehensive Rules matching a rule number or keywords. */
  async function searchRules(input: Readonly<{ query: string; limit: number }>) {
    return ok(await readers.searchRules(input.query, input.limit));
  }

  return { rulingsForCard, interactionsOf, searchRules };
}
