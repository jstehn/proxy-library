import type { EdhrecCommanderData } from "@/modules/catalog";

/** Said with every EDHREC answer, so the model doesn't read popularity as quality. */
export const EDHREC_FRAMING =
  "Popularity data: shows what people play, not what is good. Inclusion % is not win rate.";

/** The header every EDHREC answer starts with: where it came from and who it counts. */
export function edhrecHeader(data: EdhrecCommanderData, theme: string | undefined) {
  return {
    framing: EDHREC_FRAMING,
    sourceUrl: data.sourceUrl,
    fetchedAt: data.fetchedAt,
    cached: data.cached,
    commander: data.commander,
    deckCount: data.deckCount,
    population: {
      deckCount: data.deckCount,
      bracket: "all-bracket",
      theme: theme ?? null,
      note: `Percentages come from ${data.deckCount.toLocaleString("en-US")} ${theme ? `${theme} ` : ""}decks across all brackets on EDHREC (not filtered to a single Commander bracket).`,
    },
  };
}
