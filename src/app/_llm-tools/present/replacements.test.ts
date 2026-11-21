import { describe, expect, it } from "vitest";
import type { Suggestion } from "@/modules/decks";
import { presentSimilarCards } from "./replacements";

// find_replacements lists ideas, never scores (owner answers D1): no rating, rank or similarity.

function suggestion(name: string): Suggestion {
  return {
    card: {
      name,
      oracleId: `oracle-${name}`,
      printingId: `printing-${name}`,
      manaCost: "{1}{G}",
      typeLine: "Creature — Elf",
      text: "Some rules text.",
      owned: 1,
      priceCents: 25,
      isGameChanger: false,
    },
    reasons: [
      { kind: "theme", theme: "tokens" },
      { kind: "embedSim", similarityPct: 77 },
      { kind: "tribe", tribe: "Elf" },
      { kind: "keyword", keyword: "Trample" },
    ],
    rating: { rating: 91, logit: 2.3, parts: [{ kind: "quality", contribution: 0.5, label: "x" }] },
  } as unknown as Suggestion;
}

describe("presentSimilarCards", () => {
  const answer = presentSimilarCards(
    {
      like: "Llanowar Elves",
      owned: [suggestion("Elvish Mystic")],
      store: [],
      hiddenOverTarget: 0,
      avoided: [],
    },
    false,
  );
  const json = JSON.stringify(answer);

  it("shows no score, rating, rank or similarity number", () => {
    expect(json).not.toMatch(/rating|score|rank|similarity|sim\b|91|77/i);
  });

  it("lists each card with a short reason, in the order given", () => {
    expect(answer).toMatchObject({
      like: "Llanowar Elves",
      owned: [{ name: "Elvish Mystic", why: ["Tokens", "Reads like the deck", "Elves"] }],
    });
  });
});
