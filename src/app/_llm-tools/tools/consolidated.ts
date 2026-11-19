import { z } from "zod";
import {
  checkOwnedCards,
  colorPips,
  commanderOnlyProfile,
  deckView,
  effectiveManaValue,
  findCard,
  getDeckProfile,
  library,
  simulateOpeningHands,
  type MustCastByOption,
} from "@/modules/decks";
import { seededRng } from "@/shared/kernel";
import { deckNotFound, defineTool, done, failed, priceCents } from "../tool";
import {
  applyChangesTool,
  compareToEdhrecTool,
  deckSourcesTool,
  deleteDeckTool,
  edhrecCommanderTool,
  replaceDeckList,
  setDeckProfileTool,
  setPrimerTool,
  updateDeck,
} from "./decks";
import {
  budgetReplacementsTool,
  checkInteractionTool,
  getAccount,
  getCard,
  getRulingsTool,
  lookupRulesTool,
  semanticSearchForDeckTool,
  similarCardsTool,
} from "./library";
import { compactMoneyFields, stripProvenance } from "../present/money";
import { analyzeCards, searchCards, searchForDeckTool } from "./search";
import { compactWishlistPayload } from "./wishlist";

const deckIdField = z.number().int().positive().describe("Deck id from list_decks.");

/** 1. get_account */
export const getAccountCompact = defineTool({
  name: "get_account",
  title: "My account",
  description:
    "Returns your play-money balance (cents), allowance, collection totals, deck/wish counts, and optionally your wishlist.",
  scope: "read",
  readOnly: true,
  input: z.object({
    includeWishlist: z.boolean().default(false).describe("Include compact wishlist lines."),
  }),
  async run(context, input) {
    const base = await getAccount.run(context, {});
    if (!base.ok) return base;
    const compact = compactMoneyFields(base.value) as Record<string, unknown>;
    if (!input.includeWishlist) return done(compact);
    const wishlist = await compactWishlistPayload(context);
    return done({ ...compact, wishlist });
  },
});

/** 3. update_deck (merges update_deck, set_deck_profile, set_primer, deck_sources, delete_deck) */
export const updateDeckConsolidated = defineTool({
  name: "update_deck",
  title: "Update deck metadata, profile, primer, or sources",
  description:
    "Updates a deck's name, format, targetBracket, profile fields (plan, landTarget, roleTargets, keyCards, avoid), primer section/body, research sources, or deletes the deck (deleteDeck + confirm).",
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId: deckIdField,
    name: z.string().min(1).max(60).optional().describe("New deck name."),
    format: z
      .enum(["commander", "standard", "modern", "pioneer", "legacy", "vintage", "pauper", "other"])
      .optional()
      .describe("New format."),
    targetBracket: z
      .number()
      .int()
      .min(0)
      .max(5)
      .optional()
      .describe("Commander bracket 1-5, or 0 to clear."),
    usesRealCards: z.boolean().optional().describe("Count real/paper cards as owned."),
    grouping: z
      .enum(["custom", "type"])
      .optional()
      .describe("Main deck grouping: 'custom' or 'type'."),
    plan: z.string().max(1000).optional().describe("Profile: 1-2 sentence deck plan."),
    landTarget: z.number().int().min(0).max(99).optional().describe("Profile: target land count."),
    roleTargets: z
      .object({
        ramp: z.number().int().min(0).max(99).optional().describe("Ramp target."),
        draw: z.number().int().min(0).max(99).optional().describe("Draw target."),
        removal: z.number().int().min(0).max(99).optional().describe("Removal target."),
        wipe: z.number().int().min(0).max(99).optional().describe("Wipe target."),
      })
      .optional()
      .describe("Profile: role targets."),
    keyCards: z
      .array(
        z.object({
          cardName: z.string().min(1).describe("Card name."),
          reason: z.string().max(200).default("").describe("Why it is a key card."),
        }),
      )
      .max(50)
      .optional()
      .describe("Profile: pinned key cards."),
    avoid: z
      .array(
        z.object({
          cardName: z.string().min(1).describe("Card name."),
          reason: z.string().max(200).default("").describe("Why to avoid it."),
        }),
      )
      .max(100)
      .optional()
      .describe("Profile: cards to avoid."),
    primerSection: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe("Primer ## heading to patch (omit to replace full primer)."),
    primerContent: z
      .string()
      .max(20000)
      .optional()
      .describe("Markdown content for primer or section ('' clears)."),
    sourceUrl: z.string().url().optional().describe("Research source URL to save."),
    sourceTitle: z.string().min(1).max(200).optional().describe("Research source title."),
    sourceUsedFor: z
      .string()
      .max(500)
      .optional()
      .describe("What the research source was used for."),
    deleteDeck: z
      .boolean()
      .optional()
      .describe("Set true with confirm=true to permanently delete the deck."),
    confirm: z.boolean().optional().describe("Confirmation flag required when deleteDeck=true."),
  }),
  async run(context, input) {
    if (input.deleteDeck) {
      return deleteDeckTool.run(context, { deckId: input.deckId, confirm: input.confirm ?? false });
    }

    const results: Record<string, unknown> = { deckId: input.deckId };
    let didWork = false;

    if (
      input.name !== undefined ||
      input.format !== undefined ||
      input.targetBracket !== undefined ||
      input.usesRealCards !== undefined ||
      input.grouping !== undefined
    ) {
      didWork = true;
      const r = await updateDeck.run(context, {
        deckId: input.deckId,
        name: input.name,
        format: input.format,
        targetBracket: input.targetBracket,
        usesRealCards: input.usesRealCards,
        grouping: input.grouping,
      });
      if (!r.ok) return r;
      results.metadataUpdated = true;
    }

    if (
      input.plan !== undefined ||
      input.landTarget !== undefined ||
      input.roleTargets !== undefined ||
      input.keyCards !== undefined ||
      input.avoid !== undefined
    ) {
      didWork = true;
      const r = await setDeckProfileTool.run(context, {
        deckId: input.deckId,
        plan: input.plan,
        landTarget: input.landTarget,
        roleTargets: input.roleTargets,
        keyCards: input.keyCards,
        avoid: input.avoid,
      });
      if (!r.ok) return r;
      results.profileUpdated = true;
    }

    if (input.primerContent !== undefined) {
      didWork = true;
      const r = await setPrimerTool.run(context, {
        deckId: input.deckId,
        section: input.primerSection,
        content: input.primerContent,
      });
      if (!r.ok) return r;
      results.primerUpdated = true;
    }

    if (input.sourceUrl !== undefined) {
      didWork = true;
      const r = await deckSourcesTool.run(context, {
        deckId: input.deckId,
        url: input.sourceUrl,
        title: input.sourceTitle,
        usedFor: input.sourceUsedFor,
      });
      if (!r.ok) return r;
      results.sourceSaved = r.value;
    }

    if (!didWork) {
      return failed("InvalidInput", "Provide at least one field to update.");
    }
    return done(results);
  },
});

/** 4. edit_deck (merges apply_changes + replace_deck_list) */
export const editDeckConsolidated = defineTool({
  name: "edit_deck",
  title: "Preview/apply deck changes or replace deck list",
  description:
    "Edit a deck's cards via batch `changes` (save=false previews and returns previewId; commit with { deckId, previewId, save: true }) OR replace the full `list` with `fingerprint` from get_deck.",
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId: deckIdField,
    changes: z
      .array(
        z.object({
          card: z.string().min(1).describe("Exact English card name or id."),
          quantity: z
            .number()
            .int()
            .min(0)
            .max(100)
            .optional()
            .describe("Target quantity (0 removes)."),
          board: z.enum(["main", "side", "commander", "maybe"]).default("main").describe("Board."),
          note: z.string().max(400).optional().describe("Card note."),
          heading: z.string().max(200).optional().describe("Custom heading."),
          tags: z.array(z.string().min(1).max(40)).max(20).optional().describe("Tags."),
          role: z.string().max(120).optional().describe("One-line role."),
          pinned: z.boolean().optional().describe("Pin card."),
        }),
      )
      .min(1)
      .max(100)
      .optional()
      .describe("Batch changes to preview or save."),
    save: z.boolean().default(false).describe("False previews changes; true saves them."),
    previewId: z.string().min(1).optional().describe("Preview id from a prior edit_deck preview."),
    list: z.string().min(1).optional().describe("Full deck list text (for full replacement)."),
    fingerprint: z.string().min(1).optional().describe("Deck fingerprint from get_deck."),
    unnamedPrinting: z
      .enum(["cheapest", "standard"])
      .default("cheapest")
      .describe("Printing choice for unowned lines without a set code."),
  }),
  async run(context, input) {
    if (input.list !== undefined) {
      if (!input.fingerprint) {
        return failed("InvalidInput", "Provide `fingerprint` from get_deck when replacing `list`.");
      }
      return replaceDeckList.run(context, {
        deckId: input.deckId,
        list: input.list,
        fingerprint: input.fingerprint,
        unnamedPrinting: input.unnamedPrinting,
      });
    }
    return applyChangesTool.run(context, {
      deckId: input.deckId,
      changes: input.changes,
      save: input.save,
      previewId: input.previewId,
      fingerprint: input.fingerprint,
    });
  },
});

/** 5. search_cards (merges search_for_deck, search_cards, semantic_search_for_deck, analyze_cards[search]) */
export const searchCardsConsolidated = defineTool({
  name: "search_cards",
  title: "Search cards (catalog, deck-filtered, semantic, or signals)",
  description:
    "Search cards in the collection or store. Pass `deckId` to auto-filter to deck colors/format/bracket and exclude cards already in the deck. Modes: 'syntax' (default, Scryfall-style `search` or `queries`), 'semantic' (natural-language `query`), or 'signals' (recurring mechanics in owned `search`).",
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional deck id for color/format/bracket filtering."),
    mode: z.enum(["syntax", "semantic", "signals"]).default("syntax").describe("Search mode."),
    search: z
      .string()
      .min(1)
      .max(2000)
      .optional()
      .describe("Scryfall-style search string (for syntax/signals)."),
    queries: z
      .array(
        z.object({
          synergy: z.string().min(1).max(60).describe("Synergy label."),
          search: z.string().min(1).max(2000).describe("Scryfall-style search."),
        }),
      )
      .min(1)
      .max(6)
      .optional()
      .describe("Up to 6 synergy queries when deckId + mode='syntax'."),
    query: z
      .string()
      .min(1)
      .max(400)
      .optional()
      .describe("Natural-language query (for mode='semantic')."),
    where: z
      .enum(["owned", "game", "real", "store", "both"])
      .optional()
      .describe("Pool: owned, game, real, store, or both."),
    maxPerQuery: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Max cards per query (default 10)."),
    maxPriceCents: z.number().int().min(0).optional().describe("Max store price in cents."),
    includeText: z
      .boolean()
      .default(false)
      .describe("Include oracle rules text (default false to save tokens)."),
    includePrice: z
      .boolean()
      .default(false)
      .describe("Include store price in cents (default false unless requested)."),
    oneRowPerCard: z
      .boolean()
      .default(true)
      .describe("Store search: cheapest printing per card (true) or all printings (false)."),
    page: z.number().int().min(1).default(1).describe("Page number for plain syntax search."),
  }),
  async run(context, input) {
    if (input.mode === "signals") {
      return analyzeCards.run(context, {
        deckId: input.deckId,
        search: input.search ?? "",
        minimumCards: 3,
      });
    }

    if (input.mode === "semantic") {
      if (!input.deckId || !input.query) {
        return failed("InvalidInput", "Semantic search requires `deckId` and `query`.");
      }
      const where = input.where === "owned" || input.where === "store" ? input.where : "both";
      const res = await semanticSearchForDeckTool.run(context, {
        deckId: input.deckId,
        query: input.query,
        where,
        limit: input.maxPerQuery,
        maxPriceCents: input.maxPriceCents,
        includeText: input.includeText,
      });
      if (!res.ok) return res;
      return done(compactMoneyFields(stripProvenance(res.value)));
    }

    if (input.deckId !== undefined) {
      const queries =
        input.queries ?? (input.search ? [{ synergy: "search", search: input.search }] : undefined);
      if (!queries) {
        return failed("InvalidInput", "Provide `search` or `queries` when searching for a deck.");
      }
      const where = input.where === "owned" || input.where === "store" ? input.where : "both";
      const res = await searchForDeckTool.run(context, {
        deckId: input.deckId,
        queries,
        where,
        goal: "",
        maxPerQuery: input.maxPerQuery,
        maxPriceCents: input.maxPriceCents,
        includeText: input.includeText,
      });
      if (!res.ok) return res;
      const showPrice = input.includePrice || input.maxPriceCents !== undefined;
      const raw = res.value as { cards?: Record<string, unknown>[]; [k: string]: unknown };
      const compactCards = (raw.cards ?? []).map((c) => ({
        name: c.name,
        manaCost: c.manaCost,
        typeLine: c.typeLine,
        ...(input.includeText && c.text ? { text: c.text } : {}),
        owned: c.owned,
        ...(showPrice
          ? { priceCents: priceCents((c.price as { cents?: number } | null)?.cents ?? null) }
          : {}),
        synergies: c.synergies,
        ...(c.isGameChanger ? { isGameChanger: true } : {}),
      }));
      return done({ ...raw, cards: compactCards });
    }

    if (!input.search) {
      return failed("InvalidInput", "Provide `search` (or `deckId` + `queries`).");
    }
    const where =
      input.where === "owned" || input.where === "game" || input.where === "real"
        ? input.where
        : "store";
    const res = await searchCards.run(context, {
      search: input.search,
      where,
      page: input.page,
      oneRowPerCard: input.oneRowPerCard,
    });
    if (!res.ok) return res;
    const showPrice = input.includePrice || input.maxPriceCents !== undefined;
    const raw = res.value as { cards?: Record<string, unknown>[]; [k: string]: unknown };
    const compactCards = (raw.cards ?? []).slice(0, input.maxPerQuery * 2).map((c) => {
      const cheapest = (c.cheapest as { cents?: number } | null)?.cents;
      const price = (c.price as { cents?: number } | null)?.cents;
      return {
        name: c.name,
        ...(c.set ? { set: c.set } : {}),
        ...(c.source ? { source: c.source } : {}),
        ...(c.quantity !== undefined ? { quantity: c.quantity } : {}),
        ...(input.includeText && c.text ? { text: c.text } : {}),
        ...(showPrice ? { priceCents: priceCents(cheapest ?? price ?? null) } : {}),
      };
    });
    return done({ ...raw, cards: compactCards });
  },
});

/** 6. get_cards (merges get_cards + check_owned) */
export const getCardsConsolidated = defineTool({
  name: "get_cards",
  title: "Get card details or batch-check ownership",
  description:
    "Look up 1-100 cards. `detail='owned'` (fast batch check: owned counts, decks), `detail='compact'` (default, up to 25 cards: adds manaCost, typeLine, oracle rules text, wishes), or `detail='full'` (adds store printings & price trend). Prices are omitted unless `includePrice: true` or `detail='full'`.",
  scope: "read",
  readOnly: true,
  input: z.object({
    cards: z.array(z.string().min(1)).min(1).max(100).describe("Card names or ids."),
    detail: z
      .enum(["owned", "compact", "full"])
      .default("compact")
      .describe("Response detail level: 'owned', 'compact' (default), or 'full'."),
    includePrice: z
      .boolean()
      .default(false)
      .describe("Include store price in cents (default false; always included in detail='full')."),
    cursor: z.number().int().min(0).optional().describe("Pagination cursor if capped."),
  }),
  async run(context, input) {
    if (input.detail === "owned") {
      const checked = await checkOwnedCards(
        context.container.db,
        context.actor.userId,
        input.cards,
      );
      return done({
        cards: checked.map((e) =>
          e.inCatalog
            ? {
                name: e.name,
                inCatalog: true,
                ownedGame: e.ownedGame,
                ownedReal: e.ownedReal,
                ...(input.includePrice ? { priceCents: priceCents(e.cheapestPriceCents) } : {}),
                decks: e.decks,
              }
            : e,
        ),
      });
    }

    const slice = input.cards.slice(0, 25);
    const fullRes = await getCard.run(context, { cards: slice, cursor: input.cursor });
    if (!fullRes.ok) return fullRes;
    if (input.detail === "full") {
      return done(compactMoneyFields(fullRes.value));
    }

    const raw = fullRes.value as { cards?: Record<string, unknown>[] };
    const compact = (raw.cards ?? []).map((c) => {
      if (!c.found) return c;
      const faces = (c.faces as { text?: string }[] | undefined) ?? [];
      const text = faces
        .map((f) => f.text ?? "")
        .filter(Boolean)
        .join("\n---\n");
      const printings =
        (c.printingsForSale as { prices?: Record<string, { cents?: number }> }[]) ?? [];
      const allPrices = printings.flatMap((p) =>
        Object.values(p.prices ?? {})
          .map((m) => m?.cents)
          .filter((n): n is number => typeof n === "number"),
      );
      const owned = c.owned as { game?: number; real?: number; total?: number } | undefined;
      return {
        name: c.name,
        manaCost: c.manaCost,
        typeLine: c.typeLine,
        colorIdentity: c.colorIdentity,
        text,
        ownedGame: owned?.game ?? 0,
        ownedReal: owned?.real ?? 0,
        ...(input.includePrice
          ? { cheapestPriceCents: allPrices.length > 0 ? Math.min(...allPrices) : null }
          : {}),
        decksUsing: c.decksUsing,
        wishes: c.wishes,
      };
    });
    return done({ cards: compact });
  },
});

/** 7. edhrec_lookup (merges edhrec_commander + compare_to_edhrec) */
export const edhrecLookupTool = defineTool({
  name: "edhrec_lookup",
  title: "EDHREC commander & deck comparison",
  description:
    "Fetch EDHREC popularity data for a `commander` (top cards, themes) or compare a `deckId` against EDHREC (missing high-synergy cards & low-inclusion cards).",
  scope: "read",
  readOnly: true,
  input: z.object({
    commander: z.string().min(1).optional().describe("Commander name (when not passing deckId)."),
    deckId: z.number().int().positive().optional().describe("Deck id to compare against EDHREC."),
    bracket: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("Optional EDHREC bracket filter (1-5)."),
    theme: z.string().min(1).max(80).optional().describe("Optional EDHREC theme slug."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(40)
      .default(15)
      .describe("Max cards to return (default 15)."),
  }),
  async run(context, input) {
    if (input.deckId !== undefined) {
      const res = await compareToEdhrecTool.run(context, {
        deckId: input.deckId,
        bracket: input.bracket,
        theme: input.theme,
        limit: input.limit,
      });
      return res.ok ? done(compactMoneyFields(res.value)) : res;
    }
    if (!input.commander) {
      return failed("InvalidInput", "Provide `commander` or `deckId`.");
    }
    const res = await edhrecCommanderTool.run(context, {
      commander: input.commander,
      bracket: input.bracket,
      theme: input.theme,
      limit: input.limit,
    });
    return res.ok ? done(compactMoneyFields(res.value)) : res;
  },
});

/** 8. find_replacements (merges similar_cards + idea_budget_replacements) */
export const findReplacementsTool = defineTool({
  name: "find_replacements",
  title: "Find similar or budget replacement cards",
  description:
    "Find similar cards for a given `card` (optionally scoped to `deckId` and `maxPriceCents`), or find budget replacements for expensive cards in `deckId`.",
  scope: "read",
  readOnly: true,
  input: z.object({
    card: z.string().min(1).optional().describe("Card name to find alternatives for."),
    deckId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional deck id for color/format/bracket filtering."),
    where: z.enum(["owned", "store", "both"]).default("both").describe("Candidate pool."),
    maxPriceCents: z.number().int().min(0).optional().describe("Max price in cents."),
    limit: z.number().int().min(1).max(20).default(10).describe("Max candidates (default 10)."),
    includeText: z.boolean().default(false).describe("Include oracle rules text (default false)."),
  }),
  async run(context, input) {
    if (input.card) {
      const res = await similarCardsTool.run(context, {
        card: input.card,
        deckId: input.deckId,
        where: input.where,
        maxPriceCents: input.maxPriceCents,
        limit: input.limit,
        includeText: input.includeText,
      });
      return res.ok ? done(compactMoneyFields(stripProvenance(res.value))) : res;
    }
    if (input.deckId !== undefined) {
      const res = await budgetReplacementsTool.run(context, {
        deckId: input.deckId,
        where: input.where,
        maxPriceCents: input.maxPriceCents,
        perCard: 3,
        maxExpensiveCards: Math.min(8, input.limit),
        includeText: input.includeText,
      });
      return res.ok ? done(compactMoneyFields(stripProvenance(res.value))) : res;
    }
    return failed("InvalidInput", "Provide `card` or `deckId`.");
  },
});

/** 9. draw_sample (replaces goldfish_start, goldfish_step, simulate_opening_hands) */
export const drawSampleTool = defineTool({
  name: "draw_sample",
  title: "Sample opening hands, next draws & deterministic castability",
  description:
    "Deals `hands` shuffled 7-card opening hands plus the next `drawNext` cards from the deck so you can evaluate playability, and runs deterministic simulation for keepable-hand rate, turn-3 land drop rate, and optional `mustCastBy` turn-N castability.",
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId: deckIdField,
    hands: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(1)
      .describe("Opening hands to deal (1-5, default 1)."),
    drawNext: z
      .number()
      .int()
      .min(0)
      .max(15)
      .default(5)
      .describe("Next X cards drawn after the opening 7 (0-15, default 5)."),
    trials: z
      .number()
      .int()
      .min(100)
      .max(2000)
      .default(500)
      .describe("Deterministic sim trials for odds (default 500)."),
    mustCastCard: z
      .string()
      .min(1)
      .optional()
      .describe("Card name for castable-by-turn-N sim (defaults to commander)."),
    mustCastTurn: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Turn by which mustCastCard should be castable."),
    seed: z.string().max(64).optional().describe("Optional deterministic RNG seed."),
  }),
  async run(context, input) {
    const [view, storedProfile] = await Promise.all([
      deckView(context.container.db, context.actor.userId, input.deckId),
      getDeckProfile(context.container.db, context.actor.userId, input.deckId),
    ]);
    if (view === null) return deckNotFound(input.deckId);

    const cards = library(view.lines);
    if (cards.length < 7) {
      return failed("DeckTooSmall", "Deck needs at least 7 main-board cards to draw a sample.");
    }

    const lineByOracle = new Map(view.lines.map((l) => [l.oracleId, l]));
    const rng = seededRng(
      input.seed ?? `${input.deckId}:${context.container.clock.now().getTime()}`,
    );
    const samples: {
      hand: { name: string; manaCost: string; typeLine: string }[];
      nextDraws: { name: string; manaCost: string; typeLine: string }[];
    }[] = [];

    for (let h = 0; h < input.hands; h++) {
      const deckCopy = [...cards];
      for (let i = deckCopy.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [deckCopy[i], deckCopy[j]] = [deckCopy[j], deckCopy[i]];
      }
      const toCompact = (c: (typeof deckCopy)[number]) => {
        const line = lineByOracle.get(c.oracleId);
        return {
          name: c.name,
          manaCost: line?.manaCost ?? "",
          typeLine: line?.typeLine ?? "",
        };
      };
      samples.push({
        hand: deckCopy.slice(0, 7).map(toCompact),
        nextDraws: deckCopy.slice(7, 7 + input.drawNext).map(toCompact),
      });
    }

    let mustCastBy: MustCastByOption | undefined;
    if (input.mustCastTurn !== undefined) {
      const cmd = view.lines.find((l) => l.board === "commander");
      const targetName = input.mustCastCard ?? cmd?.name;
      if (targetName) {
        const line =
          view.lines.find((l) => l.name.toLowerCase() === targetName.toLowerCase()) ?? cmd;
        if (line) {
          const commanderNames = view.lines
            .filter((l) => l.board === "commander")
            .map((l) => l.name);
          const effMv = effectiveManaValue(
            line.manaValue ?? 0,
            {
              typeLine: line.typeLine,
              manaCost: line.manaCost,
              oracleText: line.text,
              isCommander: line.board === "commander",
            },
            commanderOnlyProfile(storedProfile?.profile, commanderNames),
            0,
          );
          mustCastBy = {
            cardName: line.name,
            manaValue: effMv,
            turn: input.mustCastTurn,
            inLibrary: line.board !== "commander",
            colorPips: colorPips(line.manaCost),
          };
        }
      }
    }

    const sim = simulateOpeningHands(cards, {
      rng: seededRng(input.seed ?? `sim-${view.deck.id}`),
      trials: input.trials,
      minLands: 2,
      maxLands: 4,
      requireEarlyPlay: true,
      freeMulligan: view.deck.format === "commander",
      onTheDraw: false,
      ...(mustCastBy ? { mustCastBy } : {}),
    });

    return done({
      deckId: input.deckId,
      samples,
      odds: {
        trials: sim.trials,
        keepablePct: sim.keepableRatePct,
        turn3LandPct: sim.turn3LandDropPct,
        earlyRampPct: sim.earlyRampInHandPct,
        ...(mustCastBy
          ? {
              mustCastBy: {
                card: mustCastBy.cardName,
                turn: mustCastBy.turn,
                effectiveManaValue: mustCastBy.manaValue,
                castablePct: sim.mustCastByPct ?? 0,
              },
            }
          : {}),
      },
    });
  },
});

/** 10. rules_lookup (merges get_rulings, check_interaction, lookup_rules) */
export const rulesLookupTool = defineTool({
  name: "rules_lookup",
  title: "Card rulings, interactions, and Comprehensive Rules",
  description:
    "Look up official Scryfall rulings for 1 card, check rules interactions between 2+ `cards`, or search the MTG Comprehensive Rules by rule number/keyword (`query`).",
  scope: "read",
  readOnly: true,
  input: z.object({
    cards: z
      .array(z.string().min(1))
      .min(1)
      .max(4)
      .optional()
      .describe("1 card for rulings, or 2-4 cards to check interactions."),
    query: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Comprehensive Rules number (e.g. '702.61a') or keyword."),
  }),
  async run(context, input) {
    if (input.query) {
      return lookupRulesTool.run(context, { query: input.query, limit: 8 });
    }
    if (input.cards && input.cards.length >= 2) {
      return checkInteractionTool.run(context, { cards: input.cards });
    }
    if (input.cards && input.cards.length === 1) {
      const card = await findCard(context.container.db, input.cards[0]);
      if (card === null) {
        return failed("CardNotFound", `No card named "${input.cards[0]}" in catalog.`);
      }
      return getRulingsTool.run(context, { card: card.name });
    }
    return failed("InvalidInput", "Provide `cards` (1-4 names) or `query` (CR rule/keyword).");
  },
});
