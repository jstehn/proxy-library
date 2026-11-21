import { describe, expect, it } from "vitest";
import { HttpError } from "@/shared/http";
import { httpEdhrecGateway, parseEdhrecCommanderJson } from "./edhrec-gateway";

describe("parseEdhrecCommanderJson", () => {
  it("parses cardlists, computes inclusionRate, clamps bounds, and deduplicates", () => {
    const raw = {
      container: {
        json_dict: {
          card: { num_decks: 10000 },
          cardlists: [
            {
              tag: "highsynergycards",
              cardviews: [
                { name: "Doubling Season", num_decks: 6200, potential_decks: 10000, synergy: 0.44 },
                { name: "Sol Ring", num_decks: 8500, potential_decks: 10000, synergy: 0.02 },
              ],
            },
            {
              tag: "topcards",
              cardviews: [
                { name: "Sol Ring", num_decks: 9000, potential_decks: 10000, synergy: 0.03 },
                { name: "Out of Bounds", num_decks: 20000, potential_decks: 10000, synergy: 2.5 },
              ],
            },
          ],
        },
      },
    };

    const page = parseEdhrecCommanderJson("atraxa-praetors-voice", raw);
    expect(page.slug).toBe("atraxa-praetors-voice");
    expect(page.totalDecks).toBe(10000);
    expect(page.cards).toHaveLength(3);

    const solRing = page.cards.find((c) => c.cardName === "Sol Ring");
    expect(solRing).toMatchObject({ numDecks: 9000, inclusionRate: 0.9, synergy: 0.03 });

    const outOfBounds = page.cards.find((c) => c.cardName === "Out of Bounds");
    expect(outOfBounds).toMatchObject({ inclusionRate: 1, synergy: 1 });
  });
});

describe("httpEdhrecGateway", () => {
  it("returns null on 404", async () => {
    const gateway = httpEdhrecGateway(async () => {
      throw new HttpError("https://json.edhrec.com/pages/commanders/missing.json", 404);
    });
    expect(await gateway.commanderPage("missing")).toBeNull();
  });
});
