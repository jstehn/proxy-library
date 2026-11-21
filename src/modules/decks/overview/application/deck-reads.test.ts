import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import type { DeckAuditReport } from "@/modules/decks/building/client";
import type { ManaBasePlanWithCastability } from "@/modules/decks/building/client";
import { aDeckView, aLine } from "../../testing/deck-view";
import { makeDeckFacts } from "./deck-facts";
import { makeDeckManaPlan } from "@/modules/decks/building";
import { makeDeckSignals } from "@/modules/decks/scoring";

const userId = UserId.of("1");

describe("deckFacts", () => {
  const audit = async () => ({ findings: [] }) as unknown as DeckAuditReport;

  it("lists the cards behind each role count", async () => {
    const view = aDeckView([
      aLine("Sol Ring", {
        typeLine: "Artifact",
        text: "{T}: Add {C}{C}.",
        producedMana: ["C"],
      }),
      aLine("Maybe Rock", {
        board: "maybe",
        typeLine: "Artifact",
        text: "{T}: Add {C}.",
        producedMana: ["C"],
      }),
    ]);
    const result = await makeDeckFacts({ audit })({ view, includeMaybe: false });
    expect(result.ok && result.value.roleCards.ramp).toEqual(["Sol Ring"]);
  });

  it("estimates the bracket with the maybeboard only when asked, in Commander", async () => {
    const commander = aDeckView([aLine("Elf")], { format: "commander" });
    const casual = aDeckView([aLine("Elf")]);
    const facts = makeDeckFacts({ audit });
    const asked = await facts({ view: commander, includeMaybe: true });
    const notAsked = await facts({ view: commander, includeMaybe: false });
    const outsideCommander = await facts({ view: casual, includeMaybe: true });
    expect(asked.ok && asked.value.bracketWithMaybe).toBeTruthy();
    expect(notAsked.ok && "bracketWithMaybe" in notAsked.value).toBe(false);
    expect(outsideCommander.ok && "bracketWithMaybe" in outsideCommander.value).toBe(false);
  });
});

describe("deckSignals", () => {
  it("says the deck isn't the player's when the reader returns null", async () => {
    const result = await makeDeckSignals({ signalCards: async () => null })({
      userId,
      deckId: 1,
      minimumCards: 1,
    });
    expect(result).toEqual({ ok: false, error: { kind: "DeckNotFound" } });
  });

  it("counts the cards it looked at", async () => {
    const result = await makeDeckSignals({ signalCards: async () => [] })({
      userId,
      deckId: 1,
      minimumCards: 3,
    });
    expect(result.ok && result.value.cardCount).toBe(0);
  });
});

describe("deckManaPlan", () => {
  it("passes the plan through, or says the deck isn't the player's", async () => {
    const plan = { lands: 36 } as unknown as ManaBasePlanWithCastability;
    const found = await makeDeckManaPlan({ plan: async () => plan })({ userId, deckId: 1 });
    const missing = await makeDeckManaPlan({ plan: async () => null })({ userId, deckId: 1 });
    expect(found.ok && found.value).toBe(plan);
    expect(missing).toEqual({ ok: false, error: { kind: "DeckNotFound" } });
  });
});
