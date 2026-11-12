// EDHREC anti-corruption layer (design doc 45, ADR 0007).
import { z } from "zod";
import { fetchJson, HttpError, type Fetch } from "@/shared/http";
import type { EdhrecGateway } from "../application/ports";
import {
  clampInclusionRate,
  clampSynergy,
  dedupeEdhrecEntries,
  type EdhrecCardEntry,
  type EdhrecCommanderPage,
} from "../domain/edhrec";

const EDHREC_JSON_BASE = "https://json.edhrec.com/pages/commanders";

const EdhrecCardViewSchema = z.object({
  name: z.string().min(1),
  num_decks: z.number().int().nonnegative().optional().default(0),
  potential_decks: z.number().int().nonnegative().optional().default(0),
  synergy: z.number().optional().default(0),
  inclusion: z.number().optional(),
});

const EdhrecCardListSchema = z.object({
  cardviews: z.array(EdhrecCardViewSchema).optional().default([]),
});

const EdhrecCommanderResponseSchema = z.object({
  container: z.object({
    json_dict: z.object({
      card: z
        .object({
          num_decks: z.number().int().nonnegative().optional().default(0),
        })
        .optional(),
      cardlists: z.array(EdhrecCardListSchema).optional().default([]),
    }),
  }),
});

/** Pure mapper from EDHREC's raw commander JSON to our domain `EdhrecCommanderPage`. */
export function parseEdhrecCommanderJson(slug: string, raw: unknown): EdhrecCommanderPage {
  const parsed = EdhrecCommanderResponseSchema.parse(raw);
  const dict = parsed.container.json_dict;
  const totalDecks = dict.card?.num_decks ?? 0;

  const rawEntries: EdhrecCardEntry[] = [];
  for (const list of dict.cardlists) {
    for (const card of list.cardviews) {
      const potential = card.potential_decks > 0 ? card.potential_decks : totalDecks;
      const computedRate =
        potential > 0
          ? card.num_decks / potential
          : card.inclusion !== undefined
            ? card.inclusion / 100
            : 0;
      rawEntries.push({
        cardName: card.name,
        numDecks: card.num_decks,
        potentialDecks: potential,
        inclusionRate: clampInclusionRate(computedRate),
        synergy: clampSynergy(card.synergy),
      });
    }
  }

  return {
    slug,
    totalDecks,
    cards: dedupeEdhrecEntries(rawEntries),
  };
}

export function httpEdhrecGateway(fetchFn: Fetch): EdhrecGateway {
  return {
    async commanderPage(slug: string): Promise<EdhrecCommanderPage | null> {
      const url = `${EDHREC_JSON_BASE}/${encodeURIComponent(slug)}.json`;
      try {
        const raw = await fetchJson(fetchFn, url);
        return parseEdhrecCommanderJson(slug, raw);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
