// Commander Spellbook anti-corruption layer (design doc 52, ADR 0025, ADR 0007).
import { z } from "zod";
import { HttpError, type Fetch } from "@/shared/http";
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

function addVariantToMap(rawVariant: unknown, byPair: Map<string, SpellbookTwoCardCombo>): void {
  // Fast pre-filter before running Zod over hundreds of thousands of 3+ card variants.
  if (
    typeof rawVariant !== "object" ||
    rawVariant === null ||
    !Array.isArray((rawVariant as { uses?: unknown }).uses) ||
    (rawVariant as { uses: unknown[] }).uses.length !== 2
  ) {
    return;
  }

  const variant = SpellbookVariantSchema.parse(rawVariant);
  if (variant.legalities?.commander === false) return;
  const [u1, u2] = variant.uses;
  if (!u1 || !u2) return;
  if (u1.quantity !== 1 || u2.quantity !== 1) return;
  if (!u1.card.oracleId || !u2.card.oracleId) return;
  if (u1.card.oracleId === u2.card.oracleId) return;

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

/** Pure mapper from Commander Spellbook's `variants.json` payload to two-card combos. */
export function parseSpellbookVariantsJson(raw: unknown): readonly SpellbookTwoCardCombo[] {
  const parsed = SpellbookResponseSchema.parse(raw);
  const variants = Array.isArray(parsed) ? parsed : parsed.variants;

  const byPair = new Map<string, SpellbookTwoCardCombo>();
  for (const variant of variants) {
    addVariantToMap(variant, byPair);
  }
  return Array.from(byPair.values());
}

/**
 * Streams variant objects one at a time from either `[...]` or `{"variants": [...]}`
 * without buffering the ~737 MB `variants.json` payload into a single V8 string.
 */
async function* streamVariantObjects(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");

  let inArray = false;
  let rootDepth = 0; // brace/bracket depth before entering the target array
  let objDepth = 0; // brace depth inside a single variant object
  let inString = false;
  let escaped = false;
  let capturingKey = false;
  let keyParts: string[] = [];
  let lastKey = "";
  let expectVariantsColon = false;
  let expectVariantsArray = false;
  let objParts: string[] = [];

  try {
    while (true) {
      const { value, done } = await reader.read();
      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (chunk.length > 0) {
        let sliceStart = objDepth > 0 ? 0 : -1;

        for (let i = 0; i < chunk.length; i++) {
          const ch = chunk.charAt(i);

          if (inString) {
            if (escaped) {
              escaped = false;
            } else if (ch === "\\") {
              escaped = true;
            } else if (ch === '"') {
              inString = false;
              if (capturingKey) {
                capturingKey = false;
                lastKey = keyParts.join("");
                keyParts = [];
                expectVariantsColon = lastKey === "variants";
                expectVariantsArray = false;
              }
            } else if (capturingKey) {
              keyParts.push(ch);
            }
            continue;
          }

          if (!inArray) {
            if (ch === '"') {
              inString = true;
              if (rootDepth === 1) {
                capturingKey = true;
                keyParts = [];
              }
            } else if (ch === "{" || ch === "[") {
              if (ch === "[" && (rootDepth === 0 || expectVariantsArray)) {
                inArray = true;
              } else {
                rootDepth++;
                expectVariantsColon = false;
                expectVariantsArray = false;
              }
            } else if (ch === "}" || ch === "]") {
              rootDepth--;
              expectVariantsColon = false;
              expectVariantsArray = false;
            } else if (ch === ":") {
              if (expectVariantsColon && rootDepth === 1) {
                expectVariantsColon = false;
                expectVariantsArray = true;
              }
            } else if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") {
              expectVariantsColon = false;
              expectVariantsArray = false;
            }
            continue;
          }

          // Inside the target variants array
          if (ch === '"') {
            inString = true;
          } else if (ch === "{") {
            if (objDepth === 0) {
              sliceStart = i;
              objParts = [];
            }
            objDepth++;
          } else if (ch === "}") {
            objDepth--;
            if (objDepth === 0) {
              objParts.push(chunk.slice(sliceStart, i + 1));
              sliceStart = -1;
              const rawObj = objParts.join("");
              objParts = [];
              yield JSON.parse(rawObj);
            }
          } else if (ch === "]" && objDepth === 0) {
            return;
          }
        }

        if (objDepth > 0 && sliceStart !== -1) {
          objParts.push(chunk.slice(sliceStart));
        }
      }

      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export function httpSpellbookGateway(fetchFn: Fetch): SpellbookGateway {
  return {
    async fetchTwoCardCombos() {
      const response = await fetchFn(SPELLBOOK_VARIANTS_URL, {
        headers: { "User-Agent": "ProxyLibrary/1.0 (+https://github.com/proxy-library)" },
      });
      if (!response.ok) throw new HttpError(SPELLBOOK_VARIANTS_URL, response.status);

      if (!response.body) {
        return parseSpellbookVariantsJson(await response.json());
      }

      const byPair = new Map<string, SpellbookTwoCardCombo>();
      for await (const variant of streamVariantObjects(response.body)) {
        addVariantToMap(variant, byPair);
      }
      return Array.from(byPair.values());
    },
  };
}
