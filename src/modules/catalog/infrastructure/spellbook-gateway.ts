// Commander Spellbook anti-corruption layer (design doc 52, ADR 0025, ADR 0007).
import { z } from "zod";
import { fetchJson, type Fetch } from "@/shared/http";
import type { SpellbookGateway } from "../application/ports";
import {
  canonicalComboPair,
  twoCardComboBracket,
  type SpellbookTwoCardCombo,
} from "../domain/spellbook";

export const SPELLBOOK_VARIANTS_URL = "https://json.commanderspellbook.com/variants.json";

const SpellbookUseSchema = z.object({
  quantity: z.number().int().positive().optional().default(1),
  card: z.object({
    name: z.string().min(1),
    oracleId: z.string().min(1).nullable().optional(),
  }),
});

const SpellbookProducesSchema = z.object({
  feature: z
    .object({
      name: z.string().min(1),
    })
    .optional(),
});

const SpellbookVariantSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  uses: z.array(SpellbookUseSchema).optional().default([]),
  produces: z.array(SpellbookProducesSchema).optional().default([]),
  bracketTag: z.string().nullable().optional().default(null),
  manaNeeded: z.string().nullable().optional().default(null),
  manaValueNeeded: z.number().int().nonnegative().nullable().optional().default(null),
  legalities: z
    .object({
      commander: z.boolean().optional(),
    })
    .optional(),
});

const SpellbookResponseSchema = z.union([
  z.array(SpellbookVariantSchema),
  z.object({ variants: z.array(SpellbookVariantSchema) }),
]);

/** Computes a rough mana value from a Spellbook mana string like `"{2}{U}{B}"` or `"{X}{R}{R}"`. */
export function parseManaNeededValue(manaNeeded: string | null): number | null {
  if (!manaNeeded) return null;
  const tokens = manaNeeded.match(/\{([^}]+)\}/g);
  if (!tokens || tokens.length === 0) return null;
  let total = 0;
  for (const raw of tokens) {
    const inner = raw.slice(1, -1).trim();
    if (/^\d+$/.test(inner)) {
      total += Number(inner);
    } else if (inner.toUpperCase() !== "X") {
      total += 1;
    }
  }
  return total;
}

/** Pure mapper from Commander Spellbook's `variants.json` payload to two-card combos. */
export function parseSpellbookVariantsJson(raw: unknown): readonly SpellbookTwoCardCombo[] {
  const parsed = SpellbookResponseSchema.parse(raw);
  const variants = Array.isArray(parsed) ? parsed : parsed.variants;

  const byPair = new Map<string, SpellbookTwoCardCombo>();

  for (const variant of variants) {
    if (variant.legalities?.commander === false) continue;
    if (variant.uses.length !== 2) continue;
    const [u1, u2] = variant.uses;
    if (!u1 || !u2) continue;
    if (u1.quantity !== 1 || u2.quantity !== 1) continue;
    if (!u1.card.oracleId || !u2.card.oracleId) continue;
    if (u1.card.oracleId === u2.card.oracleId) continue;

    const pair = canonicalComboPair(
      { oracleId: u1.card.oracleId, name: u1.card.name },
      { oracleId: u2.card.oracleId, name: u2.card.name },
    );
    const manaValue = variant.manaValueNeeded ?? parseManaNeededValue(variant.manaNeeded);
    const forcesBracket = twoCardComboBracket(variant.bracketTag, manaValue);
    const produces = variant.produces
      .map((p) => p.feature?.name)
      .filter((name): name is string => Boolean(name));

    const key = `${pair.oracleIdA}:${pair.oracleIdB}`;
    const existing = byPair.get(key);
    if (!existing || forcesBracket > existing.forcesBracket) {
      byPair.set(key, {
        id: variant.id,
        oracleIdA: pair.oracleIdA,
        oracleIdB: pair.oracleIdB,
        cardNameA: pair.cardNameA,
        cardNameB: pair.cardNameB,
        produces,
        bracketTag: variant.bracketTag,
        manaValue,
        forcesBracket,
      });
    }
  }

  return Array.from(byPair.values());
}

export function httpSpellbookGateway(fetchFn: Fetch): SpellbookGateway {
  return {
    async fetchTwoCardCombos() {
      const json = await fetchJson(fetchFn, SPELLBOOK_VARIANTS_URL, {
        headers: { "User-Agent": "ProxyLibrary/1.0 (+https://github.com/proxy-library)" },
      });
      return parseSpellbookVariantsJson(json);
    },
  };
}
