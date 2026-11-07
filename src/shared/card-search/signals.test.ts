import { describe, expect, it } from "vitest";
import { parseSearch } from "./parse";
import { cardSignals, phrasesOf, plainText, type SignalCard } from "./signals";

const card = (name: string, typeLine: string, text: string, extra: Partial<SignalCard> = {}) =>
  ({ name, typeLine, text, keywords: [], roleTags: [], themes: [], ...extra }) satisfies SignalCard;

// A fungus deck in the style of the Shroofus example (rules text abridged).
const FUNGUS: readonly SignalCard[] = [
  card(
    "Thallid",
    "Creature — Fungus",
    "At the beginning of your upkeep, put a spore counter on Thallid.\nRemove three spore counters from Thallid: Create a 1/1 green Saproling creature token.",
  ),
  card(
    "Thallid Germinator",
    "Creature — Fungus",
    "At the beginning of your upkeep, put a spore counter on Thallid Germinator.\nRemove three spore counters from Thallid Germinator: Create a 1/1 green Saproling creature token.\nSacrifice a Saproling: Target creature gets +1/+1 until end of turn.",
  ),
  card(
    "Deathspore Thallid",
    "Creature — Zombie Fungus",
    "At the beginning of your upkeep, put a spore counter on Deathspore Thallid.\nRemove three spore counters from Deathspore Thallid: Create a 1/1 green Saproling creature token.\nSacrifice a Saproling: Target creature gets -1/-1 until end of turn.",
  ),
  card(
    "Sporesower Thallid",
    "Creature — Fungus",
    "At the beginning of your upkeep, put a spore counter on each Fungus you control.\nRemove three spore counters from a Fungus you control: Create a 1/1 green Saproling creature token.",
  ),
  card(
    "Sporemound",
    "Creature — Fungus",
    "Whenever a land you control enters, create a 1/1 green Saproling creature token.",
  ),
  card("Llanowar Elves", "Creature — Elf Druid", "{T}: Add {G}.", { roleTags: ["ramp"] }),
];

const signal = (cards: readonly SignalCard[], name: string) =>
  cardSignals(cards).find((each) => each.name === name);

describe("cardSignals", () => {
  it("finds the spore counters and Saprolings a commander's text wouldn't mention", () => {
    expect(signal(FUNGUS, "spore counter")).toEqual({
      kind: "counter",
      name: "spore counter",
      cards: 4,
      examples: ["Thallid", "Thallid Germinator", "Deathspore Thallid", "Sporesower Thallid"],
      followUp: "o:/spore counters?/",
    });
    expect(signal(FUNGUS, "Saproling token")).toMatchObject({ kind: "token", cards: 5 });
    expect(signal(FUNGUS, "Fungus")).toMatchObject({ kind: "creatureType", cards: 5 });
    expect(signal(FUNGUS, "remove counters")).toMatchObject({ kind: "cost", cards: 4 });
  });

  it("puts the signals on the most cards first", () => {
    const counts = cardSignals(FUNGUS).map((each) => each.cards);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("needs a signal on at least minimumCards cards", () => {
    expect(signal(FUNGUS, "sacrifice trigger")).toBeUndefined();
    expect(cardSignals(FUNGUS, { minimumCards: 2 }).map((each) => each.name)).toContain(
      "sacrifice a saproling",
    );
    expect(cardSignals(FUNGUS).map((each) => each.name)).not.toContain("sacrifice a saproling");
  });

  it("counts a card once per signal, however often its text says it", () => {
    expect(signal(FUNGUS, "spore counter")?.cards).toBe(4);
  });

  it("never reads a signal from reminder text or a counterspell", () => {
    const cards = [1, 2, 3].map((number) =>
      card(
        `Rebuff ${number}`,
        "Instant",
        "Counter target spell. (Put an oil counter on it, said nobody.)",
      ),
    );
    expect(cardSignals(cards).filter((each) => each.kind === "counter")).toEqual([]);
  });

  it("finds a recurring phrase no rule names", () => {
    const cards = ["Frodo", "Samwise", "Gollum"].map((name) =>
      card(name, "Legendary Creature — Halfling", `Whenever ${name} attacks, the Ring tempts you.`),
    );
    expect(signal(cards, "ring tempts")).toMatchObject({
      kind: "phrase",
      cards: 3,
      followUp: 'o:"ring tempts"',
    });
  });

  it("gives follow-up searches that all parse with no notes", () => {
    for (const each of cardSignals(FUNGUS, { minimumCards: 1, limit: 200 })) {
      expect(parseSearch(each.followUp).notes, each.followUp).toEqual([]);
    }
  });
});

describe("plainText and phrasesOf", () => {
  it("replaces the card's name and short name with ~ and drops reminder text", () => {
    expect(
      plainText({
        name: "Jolene, the Plunder Queen",
        text: "Put four +1/+1 counters on Jolene. (Reminder.)",
      }),
    ).toBe("Put four +1/+1 counters on ~. ");
  });

  it("skips phrases made only of common words, or with numbers", () => {
    const phrases = phrasesOf("Target creature you control gets +1/+1 until end of turn.");
    expect(phrases.has("target creature")).toBe(false);
    expect(phrases.has("end of turn")).toBe(false);
    expect([...phrases].some((phrase) => /\d/.test(phrase))).toBe(false);
  });
});

describe("phrases a named signal explains", () => {
  it("leaves out a phrase that only repeats a token or counter signal", () => {
    expect(cardSignals(FUNGUS).filter((each) => each.kind === "phrase")).toEqual([]);
  });
});
