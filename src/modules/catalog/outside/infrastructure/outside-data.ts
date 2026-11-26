import { z } from "zod";
import {
  fetchJson,
  HttpError,
  platformFetch,
  withRateLimit,
  withRetry,
  withUserAgent,
  type Fetch,
} from "@/shared/http";
import type { Clock } from "@/shared/kernel";
import { commanderSlug } from "../domain/edhrec";
import type {
  ScryfallRuling,
  ScryfallRulingsResult,
  EdhrecCardItem,
  EdhrecThemeTag,
  EdhrecCommanderData,
  SpellbookCombo,
  SpellbookOneCardAwayCombo,
  SpellbookTemplateCombo,
  SpellbookTemplateRequirement,
  SpellbookCombosResult,
} from "../domain/outside-data";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CacheEntry<T> = {
  value: T;
  fetchedAt: string;
  expiresAtMs: number;
};

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly clock: Clock,
  ) {}

  async getOrFetch(
    key: string,
    fetcher: () => Promise<T>,
  ): Promise<{ value: T; fetchedAt: string; cached: boolean }> {
    const now = this.clock.now();
    const existing = this.entries.get(key);
    if (existing && existing.expiresAtMs > now.getTime()) {
      return { value: existing.value, fetchedAt: existing.fetchedAt, cached: true };
    }
    const value = await fetcher();
    const fetchedAt = now.toISOString();
    this.entries.set(key, {
      value,
      fetchedAt,
      expiresAtMs: now.getTime() + this.ttlMs,
    });
    return { value, fetchedAt, cached: false };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makePoliteFetch(clock: Clock, baseFetch: Fetch = platformFetch): Fetch {
  return withUserAgent("ProxyLibrary/1.0 (+https://github.com/proxylib)")(
    withRateLimit({ perSecond: 5, clock, sleep })(withRetry({ attempts: 2, sleep })(baseFetch)),
  );
}

// --- Scryfall Rulings ---

const ScryfallRulingSchema = z.object({
  published_at: z.string(),
  source: z.string(),
  comment: z.string(),
});

const ScryfallRulingsResponseSchema = z.object({
  data: z.array(ScryfallRulingSchema),
});

const ScryfallNamedCardSchema = z.object({
  name: z.string(),
  rulings_uri: z.string().url(),
});

async function fetchScryfallRulings(
  target: { name: string; scryfallId?: string },
  options: {
    fetchFn: Fetch;
    cache: TtlCache<{ name: string; sourceUrl: string; rulings: ScryfallRuling[] }>;
  },
): Promise<ScryfallRulingsResult | null> {
  const { fetchFn, cache } = options;
  const cacheKey = target.scryfallId
    ? `scryfall:${target.scryfallId}`
    : `name:${target.name.trim().toLowerCase()}`;

  try {
    const hit = await cache.getOrFetch(cacheKey, async () => {
      let resolvedName = target.name;
      let rulingsUrl: string;
      if (target.scryfallId) {
        rulingsUrl = `https://api.scryfall.com/cards/${encodeURIComponent(target.scryfallId)}/rulings`;
      } else {
        const namedUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(target.name.trim())}`;
        const namedRaw = await fetchJson(fetchFn, namedUrl);
        const named = ScryfallNamedCardSchema.parse(namedRaw);
        resolvedName = named.name;
        rulingsUrl = named.rulings_uri;
      }

      const raw = await fetchJson(fetchFn, rulingsUrl);
      const parsed = ScryfallRulingsResponseSchema.parse(raw);
      return {
        name: resolvedName,
        sourceUrl: rulingsUrl,
        rulings: parsed.data.map((r) => ({
          publishedAt: r.published_at,
          source: r.source,
          comment: r.comment,
        })),
      };
    });

    return {
      name: hit.value.name,
      sourceUrl: hit.value.sourceUrl,
      fetchedAt: hit.fetchedAt,
      cached: hit.cached,
      rulings: hit.value.rulings,
    };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

// --- EDHREC Commander ---

const EdhrecCardViewSchema = z.object({
  name: z.string().min(1),
  num_decks: z.number().int().nonnegative().optional().default(0),
  potential_decks: z.number().int().nonnegative().optional().default(0),
  synergy: z.number().optional().default(0),
  inclusion: z.number().optional(),
});

const EdhrecCardListSchema = z.object({
  header: z.string().optional().default("Cards"),
  cardviews: z.array(EdhrecCardViewSchema).optional().default([]),
});

const EdhrecTagLinkSchema = z.object({
  value: z.string().min(1),
  slug: z.string().min(1),
  count: z.number().int().nonnegative().optional().default(0),
});

const EdhrecPageSchema = z.object({
  container: z.object({
    json_dict: z.object({
      card: z
        .object({
          name: z.string().optional(),
          num_decks: z.number().int().nonnegative().optional().default(0),
        })
        .optional(),
      cardlists: z.array(EdhrecCardListSchema).optional().default([]),
      panels: z
        .object({
          taglinks: z.array(EdhrecTagLinkSchema).optional().default([]),
        })
        .optional(),
      taglinks: z.array(EdhrecTagLinkSchema).optional(),
      deck: z.union([z.string(), z.array(z.string())]).optional(),
      avg_deck: z.union([z.string(), z.array(z.string())]).optional(),
    }),
  }),
});

type CachedEdhrecPayload = Omit<EdhrecCommanderData, "fetchedAt" | "cached">;

function parseEdhrecCommanderPage(
  commanderName: string,
  slug: string,
  sourceUrl: string,
  raw: unknown,
): CachedEdhrecPayload {
  const parsed = EdhrecPageSchema.parse(raw);
  const dict = parsed.container.json_dict;
  const deckCount = dict.card?.num_decks ?? 0;

  const rawThemes = dict.panels?.taglinks ?? dict.taglinks ?? [];
  const themes: EdhrecThemeTag[] = rawThemes.map((t) => ({
    name: t.value,
    slug: t.slug,
    count: t.count,
  }));

  const byName = new Map<string, EdhrecCardItem>();
  for (const list of dict.cardlists) {
    for (const card of list.cardviews) {
      const potential = card.potential_decks > 0 ? card.potential_decks : deckCount;
      const rate =
        potential > 0
          ? (card.num_decks / potential) * 100
          : card.inclusion !== undefined
            ? card.inclusion
            : 0;
      const inclusionPct = Math.round(Math.max(0, Math.min(100, rate)) * 10) / 10;
      const synergy = Math.round(Math.max(-1, Math.min(1, card.synergy)) * 100) / 100;
      const key = card.name.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, {
          name: card.name,
          inclusionPct,
          synergy,
          category: list.header,
        });
      }
    }
  }

  const rawDeck = dict.avg_deck ?? dict.deck;
  let averageDecklist: string[] | null = null;
  if (typeof rawDeck === "string" && rawDeck.trim().length > 0) {
    averageDecklist = rawDeck
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } else if (Array.isArray(rawDeck) && rawDeck.length > 0) {
    averageDecklist = rawDeck.map((line) => line.trim()).filter((line) => line.length > 0);
  }

  return {
    commander: dict.card?.name ?? commanderName,
    slug,
    sourceUrl,
    deckCount,
    themes,
    cards: [...byName.values()],
    averageDecklist,
  };
}

async function fetchEdhrecCommander(
  commanderName: string,
  options: {
    theme?: string;
    budget?: "budget" | "expensive";
    fetchFn: Fetch;
    cache: TtlCache<CachedEdhrecPayload>;
  },
): Promise<EdhrecCommanderData | null> {
  const slug = commanderSlug(commanderName);
  if (slug.length === 0) return null;

  const themePart = options.theme ? `/${encodeURIComponent(commanderSlug(options.theme))}` : "";
  const budgetPart = options.budget ? `/${options.budget}` : "";
  const sourceUrl = `https://json.edhrec.com/pages/commanders/${encodeURIComponent(slug)}${themePart}${budgetPart}.json`;

  const { fetchFn, cache } = options;

  try {
    const hit = await cache.getOrFetch(sourceUrl, async () => {
      const raw = await fetchJson(fetchFn, sourceUrl);
      return parseEdhrecCommanderPage(commanderName, slug, sourceUrl, raw);
    });
    return {
      ...hit.value,
      fetchedAt: hit.fetchedAt,
      cached: hit.cached,
    };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

// --- Commander Spellbook find-my-combos ---

const SPELLBOOK_FIND_MY_COMBOS_URL = "https://backend.commanderspellbook.com/find-my-combos/";

const SpellbookComboUseSchema = z.object({
  card: z.object({
    name: z.string().min(1),
  }),
  quantity: z.number().int().positive().optional().default(1),
});

const SpellbookComboProducesSchema = z.object({
  feature: z.object({
    name: z.string().min(1),
  }),
});

const SpellbookComboRequiresSchema = z.object({
  template: z.object({
    name: z.string().min(1),
    scryfallQuery: z.string().nullable().optional(),
  }),
  quantity: z.number().int().positive().optional().default(1),
});

const SpellbookComboVariantSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  uses: z.array(SpellbookComboUseSchema).optional().default([]),
  requires: z.array(SpellbookComboRequiresSchema).optional().default([]),
  produces: z.array(SpellbookComboProducesSchema).optional().default([]),
  description: z.string().optional().default(""),
  easyPrerequisites: z.string().optional().default(""),
  notablePrerequisites: z.string().optional().default(""),
  bracketTag: z.string().nullable().optional().default(null),
  manaNeeded: z.string().nullable().optional().default(null),
  identity: z.string().optional().default(""),
});

const SpellbookFindMyCombosResponseSchema = z.object({
  results: z.object({
    included: z.array(SpellbookComboVariantSchema).optional().default([]),
    almostIncluded: z.array(SpellbookComboVariantSchema).optional().default([]),
  }),
});

type CachedSpellbookPayload = {
  complete: SpellbookCombo[];
  oneCardAway: SpellbookOneCardAwayCombo[];
  needsTemplate: SpellbookTemplateCombo[];
};

function mapTemplateRequirements(
  requires: readonly z.infer<typeof SpellbookComboRequiresSchema>[],
): SpellbookTemplateRequirement[] {
  return requires.map((req) => {
    const query = req.template.scryfallQuery?.trim();
    return {
      name: req.template.name,
      quantity: req.quantity,
      ...(query ? { scryfallQuery: query } : {}),
    };
  });
}

function mapSpellbookVariant(v: z.infer<typeof SpellbookComboVariantSchema>): SpellbookCombo {
  const prereqs = [v.easyPrerequisites, v.notablePrerequisites]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(" ");
  return {
    id: v.id,
    uses: v.uses.map((u) => u.card.name),
    produces: v.produces.map((p) => p.feature.name),
    steps: v.description.trim(),
    prerequisites: prereqs,
    bracketTag: v.bracketTag,
    manaNeeded: v.manaNeeded,
    identity: v.identity,
  };
}

function parseSpellbookFindMyCombos(
  deckCardNames: readonly string[],
  raw: unknown,
): CachedSpellbookPayload {
  const parsed = SpellbookFindMyCombosResponseSchema.parse(raw);
  const deckSet = new Set(deckCardNames.map((n) => n.trim().toLowerCase()));

  const complete: SpellbookCombo[] = [];
  const oneCardAway: SpellbookOneCardAwayCombo[] = [];
  const needsTemplate: SpellbookTemplateCombo[] = [];
  const seenTemplateIds = new Set<string>();

  const addTemplateCombo = (variant: z.infer<typeof SpellbookComboVariantSchema>) => {
    if (seenTemplateIds.has(variant.id)) return;
    seenTemplateIds.add(variant.id);
    needsTemplate.push({
      ...mapSpellbookVariant(variant),
      requires: mapTemplateRequirements(variant.requires),
    });
  };

  for (const variant of parsed.results.included) {
    if (variant.requires.length > 0) {
      // Never report a combo with an unverified generic template requirement as complete.
      addTemplateCombo(variant);
    } else {
      complete.push(mapSpellbookVariant(variant));
    }
  }

  for (const variant of parsed.results.almostIncluded) {
    const missing = variant.uses
      .map((u) => u.card.name)
      .filter((name) => !deckSet.has(name.toLowerCase()));
    if (missing.length === 1 && missing[0] !== undefined && variant.requires.length === 0) {
      oneCardAway.push({
        ...mapSpellbookVariant(variant),
        missingCardName: missing[0],
      });
    } else if (missing.length === 0 && variant.requires.length > 0) {
      addTemplateCombo(variant);
    }
  }

  return { complete, oneCardAway, needsTemplate };
}

async function fetchSpellbookCombos(
  mainCards: readonly string[],
  commanders: readonly string[],
  options: {
    fetchFn: Fetch;
    cache: TtlCache<CachedSpellbookPayload>;
  },
): Promise<SpellbookCombosResult> {
  const { fetchFn, cache } = options;
  const sortedCommanders = [...commanders].sort((a, b) => a.localeCompare(b));
  const sortedMain = [...mainCards].sort((a, b) => a.localeCompare(b));
  const cacheKey = JSON.stringify({ c: sortedCommanders, m: sortedMain });

  const hit = await cache.getOrFetch(cacheKey, async () => {
    const response = await fetchFn(SPELLBOOK_FIND_MY_COMBOS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        main: sortedMain.map((card) => ({ card })),
        commanders: sortedCommanders.map((card) => ({ card })),
      }),
    });
    if (!response.ok) {
      throw new HttpError(SPELLBOOK_FIND_MY_COMBOS_URL, response.status);
    }
    const raw = (await response.json()) as unknown;
    return parseSpellbookFindMyCombos([...sortedCommanders, ...sortedMain], raw);
  });

  return {
    sourceUrl: SPELLBOOK_FIND_MY_COMBOS_URL,
    fetchedAt: hit.fetchedAt,
    cached: hit.cached,
    complete: hit.value.complete,
    oneCardAway: hit.value.oneCardAway,
    needsTemplate: hit.value.needsTemplate,
  };
}

export type OutsideDataService = ReturnType<typeof makeOutsideData>;

/** 24h-cached external lookups for Scryfall rulings, EDHREC commanders, and Commander Spellbook. */
export function makeOutsideData(clock: Clock, baseFetch: Fetch = platformFetch) {
  const fetchFn = makePoliteFetch(clock, baseFetch);
  const rulingsCache = new TtlCache<{
    name: string;
    sourceUrl: string;
    rulings: ScryfallRuling[];
  }>(CACHE_TTL_MS, clock);
  const edhrecCache = new TtlCache<CachedEdhrecPayload>(CACHE_TTL_MS, clock);
  const spellbookCache = new TtlCache<CachedSpellbookPayload>(CACHE_TTL_MS, clock);

  return {
    fetchScryfallRulings: (target: { name: string; scryfallId?: string }) =>
      fetchScryfallRulings(target, { fetchFn, cache: rulingsCache }),
    fetchEdhrecCommander: (
      commanderName: string,
      options?: { theme?: string; budget?: "budget" | "expensive" },
    ) => fetchEdhrecCommander(commanderName, { ...options, fetchFn, cache: edhrecCache }),
    fetchSpellbookCombos: (mainCards: readonly string[], commanders: readonly string[]) =>
      fetchSpellbookCombos(mainCards, commanders, { fetchFn, cache: spellbookCache }),
  };
}
