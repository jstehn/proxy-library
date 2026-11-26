// What the outside lookups (Scryfall rulings, EDHREC, Commander Spellbook) return.

export type ScryfallRuling = Readonly<{
  publishedAt: string;
  source: string;
  comment: string;
}>;

export type ScryfallRulingsResult = Readonly<{
  name: string;
  sourceUrl: string;
  fetchedAt: string;
  cached: boolean;
  rulings: readonly ScryfallRuling[];
}>;

export type EdhrecCardItem = Readonly<{
  name: string;
  inclusionPct: number;
  synergy: number;
  category: string;
}>;

export type EdhrecThemeTag = Readonly<{
  name: string;
  slug: string;
  count: number;
}>;

export type EdhrecCommanderData = Readonly<{
  commander: string;
  slug: string;
  sourceUrl: string;
  fetchedAt: string;
  cached: boolean;
  deckCount: number;
  themes: readonly EdhrecThemeTag[];
  cards: readonly EdhrecCardItem[];
  averageDecklist: readonly string[] | null;
}>;

export type SpellbookCombo = Readonly<{
  id: string;
  uses: readonly string[];
  produces: readonly string[];
  steps: string;
  prerequisites: string;
  bracketTag: string | null;
  manaNeeded: string | null;
  identity: string;
}>;

export type SpellbookTemplateRequirement = Readonly<{
  name: string;
  quantity: number;
  scryfallQuery?: string;
}>;

export type SpellbookOneCardAwayCombo = SpellbookCombo &
  Readonly<{
    missingCardName: string;
  }>;

/** A combo whose named cards are all in the deck, but that still needs 1+ generic template pieces. */
export type SpellbookTemplateCombo = SpellbookCombo &
  Readonly<{
    requires: readonly SpellbookTemplateRequirement[];
  }>;

export type SpellbookCombosResult = Readonly<{
  sourceUrl: string;
  fetchedAt: string;
  cached: boolean;
  complete: readonly SpellbookCombo[];
  oneCardAway: readonly SpellbookOneCardAwayCombo[];
  needsTemplate?: readonly SpellbookTemplateCombo[];
}>;
