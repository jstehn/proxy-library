import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seededRng } from "@/shared/kernel";
import { atSecond, conspiracyTable, contextAt, fillers, nameOf } from "../testing/conspiracy";
import { peekAtPack, sneakablePacks, watchPlayer } from "./actions";
import { guessedRight, type CardRef, type Note } from "./abilities";
import { acceptDeal, offerForDeal, revealForDeal } from "./deals";
import {
  currentPack,
  draftedBy,
  poolOf,
  queueOf,
  refOf,
  seatAt,
  withAbilities,
  withCard,
  type Draft,
  type DraftCard,
} from "./draft";
import {
  chooseColor,
  decideOnCard,
  draftStep,
  owedColor,
  type StepChoices,
  type StepContext,
} from "./steps";
import { actFor, runTimers } from "./timers";
import { visibleTo } from "./visibility";

const ctx = contextAt();
const names = (cards: readonly DraftCard[]) => cards.map((card) => nameOf(card.printingId));
const frontNames = (draft: Draft, seat: number) =>
  names(currentPack(draft, seat)?.cards.filter((card) => card.pick === null) ?? []);

/** The seat drafts the first card with this name in the pack in front of it. */
function pick(
  draft: Draft,
  seat: number,
  name: string,
  choices: StepChoices = {},
  at: StepContext = ctx,
): Draft {
  const pack = currentPack(draft, seat);
  const card = pack?.cards.find((each) => each.pick === null && nameOf(each.printingId) === name);
  if (pack === null || card === undefined)
    throw new Error(`seat ${seat} has no ${name} in front: ${frontNames(draft, seat)}`);
  const stepped = draftStep(
    draft,
    { seatNumber: seat, packNumber: pack.packNumber, slot: card.slot, auto: false, choices },
    at,
  );
  if (!stepped.ok)
    throw new Error(
      `${stepped.error.kind} ${"reason" in stepped.error ? stepped.error.reason : ""}`,
    );
  return stepped.value.draft;
}

/** Where the seat's drafted card with this name is (the first one, unless `which`). */
function drafted(draft: Draft, seat: number, name: string, which = 0): CardRef {
  for (const pack of draft.packs) {
    const found = pack.cards.filter(
      (card) => card.pick?.seat === seat && nameOf(card.printingId) === name,
    );
    if (found.length > which) return refOf(pack, found[which]);
    which -= found.length;
  }
  throw new Error(`seat ${seat} hasn't drafted ${name}`);
}

function card(draft: Draft, ref: CardRef): DraftCard {
  const found = draft.packs
    .find((pack) => pack.packNumber === ref.packNumber)
    ?.cards.find((each) => each.slot === ref.slot);
  if (found === undefined) throw new Error("no such card");
  return found;
}

const notes = (draft: Draft, ref: CardRef): readonly Note[] => card(draft, ref).pick?.notes ?? [];
const stateOf = (draft: Draft, ref: CardRef) => card(draft, ref).pick?.state;
const revealsFor = (draft: Draft, seat: number | null) =>
  draft.reveals
    .filter((each) => each.audience === seat)
    .map((each) => ({ kind: each.kind, cards: each.cards.map((c) => nameOf(c.printingId)) }));

describe("notes made as a card is drafted", () => {
  it("counts cards drafted this round, including it, and starts again each round", () => {
    let draft = conspiracyTable([
      [["Bear", "Lurking Automaton", "Bear"], ["Pyretic Hunter"], ["Bear"]],
      [fillers(3), ["Bear"], ["Bear"]],
    ]);
    draft = pick(draft, 0, "Bear");
    draft = pick(draft, 1, "Bear");
    draft = pick(draft, 1, "Lurking Automaton"); // p1's second card this round
    expect(notes(draft, drafted(draft, 1, "Lurking Automaton"))).toEqual([
      { kind: "count", value: 2 },
    ]);
    draft = pick(draft, 0, "Bear");
    draft = pick(draft, 0, "Bear");
    draft = pick(draft, 1, "Bear");
    expect(draft.round).toBe(2);
    draft = pick(draft, 0, "Pyretic Hunter"); // first card of round 2
    expect(notes(draft, drafted(draft, 0, "Pyretic Hunter"))).toEqual([
      { kind: "count", value: 1 },
    ]);
    expect(revealsFor(draft, null).map((each) => each.cards[0])).toEqual([
      "Lurking Automaton",
      "Pyretic Hunter",
    ]);
  });

  it("Cogwork Tracker notes who passed it to you; nobody, from a pack you opened", () => {
    let draft = conspiracyTable([
      [["Cogwork Tracker", "Bear"], ["Bear"], ["Bear"]],
      [["Bear", "Cogwork Tracker"], ["Bear"], ["Bear"]],
    ]);
    draft = pick(draft, 0, "Cogwork Tracker");
    draft = pick(draft, 1, "Bear");
    draft = pick(draft, 0, "Cogwork Tracker");
    expect(notes(draft, drafted(draft, 0, "Cogwork Tracker", 0))).toEqual([
      { kind: "passedBy", seat: null },
    ]);
    expect(notes(draft, drafted(draft, 0, "Cogwork Tracker", 1))).toEqual([
      { kind: "passedBy", seat: 1 },
    ]);
  });
});

describe("Paliano, the High City and Regicide: right neighbor, you, then left neighbor", () => {
  it("asks the players in order, each before their own next pick", () => {
    let draft = conspiracyTable([
      [fillers(3), ["Bear"], ["Bear"]],
      [["Paliano, the High City", "Bear", "Bear"], ["Bear"], ["Bear"]],
      [fillers(3), ["Bear"], ["Bear"]],
    ]);
    draft = pick(draft, 1, "Paliano, the High City");
    expect(owedColor(draft, 0)?.note.choosers).toEqual([0, 1, 2]); // seat 0 is on seat 1's right
    expect(owedColor(draft, 1)).toBeNull(); // not yet: the right neighbor chooses first
    const front = currentPack(draft, 0);
    expect(
      draftStep(
        draft,
        { seatNumber: 0, packNumber: front?.packNumber ?? -1, slot: 0, auto: false },
        ctx,
      ),
    ).toEqual({ ok: false, error: { kind: "ChooseColorsFirst" } });
    draft = pick(draft, 2, "Bear"); // the left neighbor isn't held up yet

    const chose = (seat: number, color: "W" | "U" | "B") => {
      const done = chooseColor(draft, seat, color, ctx);
      if (!done.ok) throw new Error(done.error.reason);
      draft = done.value;
    };
    chose(0, "W");
    expect(chooseColor(draft, 1, "W", ctx).ok).toBe(false); // the colors must differ
    chose(1, "U");
    chose(2, "B");
    expect(notes(draft, drafted(draft, 1, "Paliano, the High City"))).toEqual([
      { kind: "colors", choosers: [0, 1, 2], colors: ["W", "U", "B"] },
    ]);
  });

  it("with two players, the other player chooses first and third; the draft ends once they have", () => {
    let draft = conspiracyTable([
      [["Bear"], ["Bear"], ["Regicide"]],
      [["Bear"], ["Bear"], ["Bear"]],
    ]);
    for (const round of [1, 2]) {
      draft = pick(pick(draft, 0, "Bear"), 1, "Bear");
      expect(draft.round).toBe(round + 1);
    }
    draft = pick(draft, 0, "Regicide");
    const chose = (seat: number, color: "R" | "G" | "B") => {
      const done = chooseColor(draft, seat, color, ctx);
      if (!done.ok) throw new Error(done.error.reason);
      draft = done.value;
    };
    // p1 is on p0's right: they choose first, before their own next pick.
    chose(1, "R");
    draft = pick(draft, 1, "Bear");
    expect(draft.status).toBe("drafting"); // colors still owed
    chose(0, "G");
    chose(1, "B");
    expect(draft.status).toBe("finished");
  });
});

describe("cards that wait for a later card", () => {
  it("Aether Searcher notes the next card you draft, even in the next round", () => {
    let draft = conspiracyTable([
      [["Aether Searcher"], ["Elf"], ["Bear"]],
      [["Bear"], ["Bear"], ["Bear"]],
    ]);
    draft = pick(pick(draft, 0, "Aether Searcher"), 1, "Bear");
    draft = pick(draft, 0, "Elf");
    expect(notes(draft, drafted(draft, 0, "Aether Searcher"))).toEqual([
      { kind: "name", name: "Elf", from: drafted(draft, 0, "Elf") },
    ]);
    expect(revealsFor(draft, null).at(-1)?.cards).toEqual(["Elf"]);
  });

  it("Cogwork Spy shows you the next card drafted from that pack, and only you", () => {
    let draft = conspiracyTable([
      [["Cogwork Spy", "Elf", "Bear"], ["Bear"], ["Bear"]],
      [fillers(3), ["Bear"], ["Bear"]],
      [fillers(3), ["Bear"], ["Bear"]],
    ]);
    draft = pick(draft, 0, "Cogwork Spy");
    draft = pick(draft, 1, "Bear"); // from p1's own pack: nothing to see
    expect(revealsFor(draft, 0)).toEqual([]);
    draft = pick(draft, 1, "Elf"); // from the Spy's pack
    expect(revealsFor(draft, 0)).toEqual([{ kind: "spied", cards: ["Elf"] }]);
    expect(revealsFor(draft, 2)).toEqual([]);
  });

  it("Spire Phantasm: you guess, the next drafter reveals their card to everyone", () => {
    let draft = conspiracyTable([
      [["Spire Phantasm", "Elf", "Bear"], ["Bear"], ["Bear"]],
      [fillers(3), ["Bear"], ["Bear"]],
    ]);
    draft = pick(draft, 0, "Spire Phantasm", { guess: "elf " });
    draft = pick(draft, 1, "Bear");
    draft = pick(draft, 1, "Elf");
    const [guess] = notes(draft, drafted(draft, 0, "Spire Phantasm"));
    expect(guess).toEqual({ kind: "guess", guess: "elf", actual: "Elf" });
    expect(guess.kind === "guess" && guessedRight(guess)).toBe(true);
    expect(revealsFor(draft, null).at(-1)).toEqual({ kind: "guessed", cards: ["Elf"] });
  });
});

describe("Lore Seeker", () => {
  it("adds a pack you draft from next; the round lasts until it's empty too", () => {
    let draft = conspiracyTable([
      [["Lore Seeker", "Bear"], ["Bear"], ["Bear"]],
      [["Bear", "Bear"], ["Bear"], ["Bear"]],
    ]);
    draft = pick(draft, 0, "Lore Seeker", {
      addPack: {
        pack: {
          seed: "added",
          cards: ["Elf", "Elf", "Bolt"].map((name, slot) => ({
            printingId: `${name}@x.${slot}` as never,
            finish: "nonfoil" as const,
          })),
        },
        basics: [],
      },
    });
    draft = pick(draft, 1, "Bear"); // p1 passes its pack to p0, behind the added one
    expect(frontNames(draft, 0)).toEqual(["Elf", "Elf", "Bolt"]);
    expect(queueOf(draft, 0)).toHaveLength(2);
    draft = pick(draft, 0, "Bolt");
    draft = pick(pick(draft, 0, "Bear"), 1, "Bear"); // the original packs are empty now
    expect(draft.round).toBe(1); // the added pack still has cards
    draft = pick(draft, 1, "Elf");
    draft = pick(draft, 0, "Elf");
    expect(draft.round).toBe(2);
  });
});

describe("extra cards from one pack", () => {
  it("Cogwork Librarian: a second card, then the Librarian goes into the pack (face up for its next drafter)", () => {
    let draft = conspiracyTable([
      [["Cogwork Librarian", "Bear"], ["Cogwork Spy", "Elf", "Bolt"], ["Bear"]],
      [["Bear", "Bear"], fillers(3), ["Bear"]],
    ]);
    draft = pick(pick(draft, 0, "Cogwork Librarian"), 1, "Bear");
    draft = pick(pick(draft, 0, "Bear"), 1, "Bear");
    expect(draft.round).toBe(2);
    draft = pick(draft, 0, "Cogwork Spy", { librarians: 1 });
    expect(frontNames(draft, 0)).toEqual(["Elf", "Bolt"]); // still p0's turn with this pack
    draft = pick(draft, 0, "Elf");
    // The Spy did nothing: its drafter drafted the next card from that pack.
    expect(revealsFor(draft, 0)).toEqual([]);
    const librarian = drafted(draft, 0, "Cogwork Librarian");
    expect(stateOf(draft, librarian)).toBe("returned");
    expect(names(poolOf(draft, 0))).toEqual(["Bear", "Cogwork Spy", "Elf"]);
    // The pack moves on with the Librarian in it.
    expect(frontNames(draft, 1)).toEqual(["Bear", "Bear", "Bear"]);
    draft = pick(draft, 1, "Bear"); // from p1's own pack; then p0's arrives, Librarian and all
    expect(frontNames(draft, 1)).toEqual(["Bolt", "Cogwork Librarian"]);
    draft = pick(draft, 1, "Cogwork Librarian");
    expect(stateOf(draft, drafted(draft, 1, "Cogwork Librarian"))).toBe("faceUp");
    expect(card(draft, drafted(draft, 1, "Cogwork Librarian")).cameFrom).toEqual(librarian);
  });

  it("refuses a second card the pack doesn't have, or a Librarian you don't have face up", () => {
    let draft = conspiracyTable([
      [["Bear", "Elf"], ["Bear"], ["Bear"]],
      [["Bear", "Elf"], ["Bear"], ["Bear"]],
    ]);
    const front = currentPack(draft, 0);
    expect(
      draftStep(
        draft,
        {
          seatNumber: 0,
          packNumber: front?.packNumber ?? -1,
          slot: 0,
          auto: false,
          choices: { librarians: 1 },
        },
        ctx,
      ),
    ).toMatchObject({ ok: false, error: { kind: "AbilityUnavailable" } });
    draft = pick(draft, 0, "Bear");
    expect(draft.packs.length).toBe(6);
  });

  it("Leovold's Operative: a second card, then the next pack you're passed goes straight on", () => {
    let draft = conspiracyTable([
      [["Leovold's Operative", "Bear", "Bear", "Bear"], fillers(4), fillers(4)],
      [["Bear", "Elf", "Bear", "Bear"], fillers(4), fillers(4)],
    ]);
    draft = pick(pick(draft, 0, "Leovold's Operative"), 1, "Bear");
    draft = pick(draft, 0, "Elf", { operatives: 1 });
    draft = pick(draft, 0, "Bear");
    const operative = drafted(draft, 0, "Leovold's Operative");
    expect(stateOf(draft, operative)).toBe("faceDown");
    expect(seatAt(draft, 0).abilities.skipPacks).toBe(1);
    draft = pick(draft, 1, "Bear"); // passes 2 cards to p0, who passes them straight back
    expect(seatAt(draft, 0).abilities.skipPacks).toBe(0);
    expect(currentPack(draft, 0)).toBeNull();
    expect(revealsFor(draft, 0)).toEqual([{ kind: "passedOn", cards: ["Bear", "Bear"] }]);
    expect(queueOf(draft, 1)).toHaveLength(2);
  });

  it("Leovold's Operative's skip can be the pack you open next round", () => {
    let draft = conspiracyTable([
      [["Leovold's Operative"], ["Bear", "Bear"], fillers(2)],
      [["Bear", "Elf", "Bolt"], fillers(2), fillers(2)],
    ]);
    draft = pick(pick(draft, 0, "Leovold's Operative"), 1, "Bear");
    draft = pick(draft, 0, "Elf", { operatives: 1 });
    draft = pick(draft, 0, "Bolt");
    expect(draft.round).toBe(2);
    expect(currentPack(draft, 0)).toBeNull(); // p0's own round-2 pack went straight on
    expect(queueOf(draft, 1).map((pack) => pack.openedBySeat)).toEqual([1, 0]);
  });

  it("Agent of Acquisitions: the whole pack in your order, then nothing more this round", () => {
    let draft = conspiracyTable([
      [["Agent of Acquisitions", "Bear", "Bear"], ["Bear"], ["Bear"]],
      [["Elf", "Bolt", "Lurking Automaton"], ["Bear"], ["Bear"]],
    ]);
    draft = pick(pick(draft, 0, "Agent of Acquisitions"), 1, "Elf");
    draft = pick(draft, 0, "Lurking Automaton", { wholePack: true });
    expect(frontNames(draft, 0)).toEqual(["Bolt"]); // still p0's turn
    draft = pick(draft, 0, "Bolt");
    expect(notes(draft, drafted(draft, 0, "Lurking Automaton"))).toEqual([
      { kind: "count", value: 2 },
    ]);
    expect(stateOf(draft, drafted(draft, 0, "Agent of Acquisitions"))).toBe("faceDown");
    draft = pick(draft, 1, "Bear"); // passes the last Bear to p0, who's locked out
    expect(revealsFor(draft, 0)).toEqual([{ kind: "passedOn", cards: ["Bear"] }]);
    draft = pick(draft, 1, "Bear");
    expect(draft.round).toBe(2);
    expect(frontNames(draft, 0)).toEqual(["Bear"]); // drafting again in round 2
  });
});

describe("taking cards out of the draft", () => {
  it("Cogwork Grinder: removed face down, out of your pool, still counted and still revealed", () => {
    let draft = conspiracyTable([
      [["Cogwork Grinder", "Bear"], ["Bear"], ["Bear"]],
      [["Elf", "Lurking Automaton"], ["Bear"], ["Bear"]],
    ]);
    draft = pick(pick(draft, 0, "Cogwork Grinder"), 1, "Elf");
    draft = pick(draft, 0, "Lurking Automaton", { remove: "faceDown" });
    const lurking = drafted(draft, 0, "Lurking Automaton");
    expect(stateOf(draft, lurking)).toBe("removedFaceDown");
    expect(notes(draft, lurking)).toEqual([{ kind: "count", value: 2 }]);
    expect(names(poolOf(draft, 0))).toEqual(["Cogwork Grinder"]);
    expect(names(draftedBy(draft, 0))).toEqual(["Cogwork Grinder", "Lurking Automaton"]);
    expect(revealsFor(draft, null).map((each) => each.kind)).toEqual(["revealed"]);
  });

  it("Animus of Predation: removed face up, for everyone to see; nothing to remove with, no removing", () => {
    let draft = conspiracyTable([
      [["Animus of Predation", "Bear"], ["Bear"], ["Bear"]],
      [["Bear", "Elf"], ["Bear"], ["Bear"]],
    ]);
    const front = currentPack(draft, 0);
    expect(
      draftStep(
        draft,
        {
          seatNumber: 0,
          packNumber: front?.packNumber ?? -1,
          slot: 0,
          auto: false,
          choices: { remove: "faceUp" },
        },
        ctx,
      ),
    ).toMatchObject({ ok: false, error: { kind: "AbilityUnavailable" } });
    draft = pick(pick(draft, 0, "Animus of Predation"), 1, "Bear");
    draft = pick(draft, 0, "Elf", { remove: "faceUp" });
    expect(revealsFor(draft, null)).toEqual([{ kind: "removed", cards: ["Elf"] }]);
  });
});

describe("noting a later card", () => {
  const table = (first: string, second: string) =>
    conspiracyTable([
      [[first, "Bear"], ["Bear"], ["Bear"]],
      [["Bolt", second], ["Bear"], ["Bear"]],
    ]);

  it("Noble Banneret notes a creature's name, then turns face down; not a non-creature", () => {
    let draft = pick(pick(table("Noble Banneret", "Elf"), 0, "Noble Banneret"), 1, "Bolt");
    const banneret = drafted(draft, 0, "Noble Banneret");
    draft = pick(draft, 0, "Elf", { noteWith: [banneret] });
    expect(notes(draft, banneret)).toEqual([
      { kind: "name", name: "Elf", from: drafted(draft, 0, "Elf") },
    ]);
    expect(stateOf(draft, banneret)).toBe("faceDown");

    let other = pick(pick(table("Noble Banneret", "Bolt"), 0, "Noble Banneret"), 1, "Bolt");
    const front = currentPack(other, 0);
    const bolt = front?.cards.find((each) => each.pick === null);
    expect(
      draftStep(
        other,
        {
          seatNumber: 0,
          packNumber: front?.packNumber ?? -1,
          slot: bolt?.slot ?? -1,
          auto: false,
          choices: { noteWith: [drafted(other, 0, "Noble Banneret")] },
        },
        ctx,
      ),
    ).toMatchObject({ ok: false, error: { kind: "AbilityUnavailable" } });
    other = pick(other, 0, "Bolt");
    expect(stateOf(other, drafted(other, 0, "Noble Banneret"))).toBe("faceUp");
  });

  it("Paliano Vanguard notes creature types; Smuggler Captain notes any card", () => {
    let draft = pick(pick(table("Paliano Vanguard", "Elf"), 0, "Paliano Vanguard"), 1, "Bolt");
    const vanguard = drafted(draft, 0, "Paliano Vanguard");
    draft = pick(draft, 0, "Elf", { noteWith: [vanguard] });
    expect(notes(draft, vanguard)).toEqual([
      { kind: "types", types: ["Elf", "Druid"], from: drafted(draft, 0, "Elf") },
    ]);

    let smuggled = pick(pick(table("Smuggler Captain", "Bolt"), 0, "Smuggler Captain"), 1, "Bolt");
    const captain = drafted(smuggled, 0, "Smuggler Captain");
    smuggled = pick(smuggled, 0, "Bolt", { noteWith: [captain] });
    expect(notes(smuggled, captain)[0]).toMatchObject({ kind: "name", name: "Bolt" });
  });
});

describe("Archdemon of Paliano", () => {
  it("makes your next three cards random (across rounds), each seen only once drafted", () => {
    let draft = conspiracyTable([
      [["Archdemon of Paliano", "Bear", "Bear"], fillers(3), fillers(3)],
      [fillers(3), fillers(3), fillers(3)],
    ]);
    draft = pick(pick(draft, 0, "Archdemon of Paliano"), 1, "Bear");
    const archdemon = drafted(draft, 0, "Archdemon of Paliano");
    const atRandom = (state: Draft) => {
      const front = currentPack(state, 0);
      const pointed = draftStep(
        state,
        { seatNumber: 0, packNumber: front?.packNumber ?? -1, slot: 0, auto: false },
        ctx,
      );
      expect(pointed).toEqual({ ok: false, error: { kind: "MustDraftAtRandom" } });
      const drawn = draftStep(
        state,
        { seatNumber: 0, packNumber: front?.packNumber ?? -1, slot: "random", auto: false },
        ctx,
      );
      if (!drawn.ok) throw new Error(drawn.error.kind);
      expect(seatAt(drawn.value.draft, 0).abilities.awaitingChoices).toEqual(drawn.value.card);
      // Nothing else until the choices about that card are made.
      expect(
        draftStep(
          drawn.value.draft,
          { seatNumber: 0, packNumber: 0, slot: "random", auto: false },
          ctx,
        ),
      ).toEqual({
        ok: false,
        error: { kind: "AwaitingChoices" },
      });
      const decided = decideOnCard(drawn.value.draft, 0, {}, ctx);
      if (!decided.ok) throw new Error(decided.error.kind);
      return decided.value;
    };
    draft = atRandom(draft);
    draft = pick(draft, 1, "Bear");
    draft = atRandom(draft);
    draft = pick(draft, 1, "Bear");
    expect(draft.round).toBe(2);
    expect(notes(draft, archdemon)).toEqual([{ kind: "randomDrafted", count: 2 }]);
    draft = atRandom(draft); // the third, in round 2
    expect(stateOf(draft, archdemon)).toBe("faceDown");
    draft = pick(draft, 1, "Bear");
    draft = pick(draft, 0, "Bear"); // free to look again
  });
});

describe("Canal Dredger", () => {
  const table = () =>
    conspiracyTable([
      [["Canal Dredger", "Bear", "Bear"], ["Bear"], ["Bear"]],
      [["Elf", "Elf", "Elf"], ["Bear"], ["Bear"]],
      [["Bolt", "Bolt", "Bolt"], ["Bear"], ["Bear"]],
    ]);

  it("gets the last card of every pack, instead of the neighbor; to yourself, you draft it next", () => {
    let draft = pick(pick(pick(table(), 0, "Canal Dredger"), 1, "Elf"), 2, "Bolt");
    draft = pick(draft, 1, "Bear"); // one Bear left: it goes to p0, not p2
    const lastBear = draft.packs.find((pack) => pack.openedBySeat === 0 && pack.round === 1);
    expect(lastBear?.holderSeat).toBe(0);
    draft = pick(draft, 0, "Bolt"); // one Bolt left: p0 passes it to themselves, to draft next
    expect(frontNames(draft, 0)).toEqual(["Bolt"]);
  });

  it("is drafted from even by a player who would otherwise pass it on (decision 3)", () => {
    let draft = pick(pick(pick(table(), 0, "Canal Dredger"), 1, "Elf"), 2, "Bolt");
    draft = withAbilities(draft, 0, (abilities) => ({ ...abilities, skipPacks: 1 }));
    draft = pick(draft, 1, "Bear"); // the last Bear reaches p0, who drafts it anyway…
    expect(queueOf(draft, 0).some((pack) => pack.openedBySeat === 0)).toBe(true);
    expect(seatAt(draft, 0).abilities.skipPacks).toBe(0); // …after passing on the 2-card pack
  });
});

describe("any time during the draft", () => {
  it("Whispergear Sneak looks at an unopened pack, or one nobody is looking at, once", () => {
    let draft = conspiracyTable([
      [["Whispergear Sneak", "Bear"], ["Elf", "Bolt"], ["Bear"]],
      [["Bear", "Bear"], ["Bear"], ["Bear"]],
    ]);
    draft = pick(draft, 0, "Whispergear Sneak");
    const sneak = drafted(draft, 0, "Whispergear Sneak");
    const theirs = currentPack(draft, 1)?.packNumber ?? -1;
    expect(sneakablePacks(draft)).not.toContain(theirs); // p1 is looking at it
    const unopened =
      draft.packs.find((pack) => pack.round === 2 && pack.openedBySeat === 0)?.packNumber ?? -1;
    const peeked = peekAtPack(draft, 0, sneak, unopened, ctx);
    if (!peeked.ok) throw new Error(peeked.error.kind);
    expect(revealsFor(peeked.value, 0)).toEqual([{ kind: "peeked", cards: ["Elf", "Bolt"] }]);
    expect(revealsFor(peeked.value, 1)).toEqual([]);
    expect(peekAtPack(peeked.value, 0, sneak, unopened, ctx).ok).toBe(false); // face down now
  });

  it("Illusionary Informant shows you the next card a chosen player drafts", () => {
    let draft = conspiracyTable([
      [["Illusionary Informant", "Bear"], ["Bear"], ["Bear"]],
      [["Elf", "Bear"], ["Bear"], ["Bear"]],
      [["Bolt", "Bear"], ["Bear"], ["Bear"]],
    ]);
    draft = pick(draft, 0, "Illusionary Informant");
    const watched = watchPlayer(draft, 0, drafted(draft, 0, "Illusionary Informant"), 1, ctx);
    if (!watched.ok) throw new Error(watched.error.kind);
    draft = pick(watched.value, 2, "Bolt");
    draft = pick(draft, 1, "Elf");
    draft = pick(draft, 1, "Bear");
    expect(revealsFor(draft, 0)).toEqual([{ kind: "informed", cards: ["Elf"] }]);
  });
});

describe("Deal Broker, right after the draft", () => {
  it("reveals a card, takes offers revealed together, and swaps pools on acceptance", () => {
    let draft = conspiracyTable([
      [["Deal Broker"], ["Bear"], ["Bear"]],
      [["Elf"], ["Bolt"], ["Bear"]],
    ]);
    for (const round of [1, 2, 3]) {
      const first = round === 1 ? "Deal Broker" : "Bear";
      draft = pick(draft, 0, first);
      draft = pick(draft, 1, frontNames(draft, 1)[0]);
    }
    expect(draft.status).toBe("dealing");
    expect(draft.deals?.current).toMatchObject({ brokerSeat: 0, stage: "reveal" });
    const answer = (result: ReturnType<typeof revealForDeal>) => {
      if (!result.ok) throw new Error(result.error.kind);
      return result.value;
    };
    const bear = drafted(draft, 0, "Bear");
    draft = answer(revealForDeal(draft, 0, bear, ctx));
    expect(offerForDeal(draft, 1, drafted(draft, 0, "Bear", 1), ctx).ok).toBe(false); // not theirs
    draft = answer(offerForDeal(draft, 1, drafted(draft, 1, "Bolt"), ctx));
    expect(draft.deals?.current?.stage).toBe("accept");
    draft = answer(acceptDeal(draft, 0, 1, ctx));
    expect(draft.status).toBe("finished");
    expect(names(poolOf(draft, 0)).sort()).toEqual(["Bear", "Bolt", "Deal Broker"]);
    expect(names(poolOf(draft, 1)).sort()).toEqual(["Bear", "Bear", "Elf"]);
  });

  it("moves on by itself when the timer runs out", () => {
    let draft = conspiracyTable(
      [
        [["Deal Broker"], ["Bear"], ["Bear"]],
        [["Elf"], ["Bolt"], ["Bear"]],
      ],
      { timer: { kind: "on", secondsPerPick: 30 } },
    );
    for (const round of [1, 2, 3]) {
      draft = pick(draft, 0, round === 1 ? "Deal Broker" : "Bear");
      draft = pick(draft, 1, frontNames(draft, 1)[0]);
    }
    expect(draft.status).toBe("dealing");
    const later = runTimers(draft, contextAt(61 + 31), () => 0).draft;
    expect(later.status).toBe("finished");
  });
});

describe("any table, with bots taking every turn", () => {
  const POOL = [
    "Bear",
    "Elf",
    "Bolt",
    "Brago",
    "Lurking Automaton",
    "Cogwork Tracker",
    "Paliano, the High City",
    "Regicide",
    "Aether Searcher",
    "Cogwork Spy",
    "Spire Phantasm",
    "Lore Seeker",
    "Cogwork Librarian",
    "Leovold's Operative",
    "Agent of Acquisitions",
    "Cogwork Grinder",
    "Animus of Predation",
    "Noble Banneret",
    "Paliano Vanguard",
    "Smuggler Captain",
    "Archdemon of Paliano",
    "Canal Dredger",
    "Whispergear Sneak",
    "Illusionary Informant",
    "Deal Broker",
  ];

  it("always finishes, with every card drafted exactly once", () => {
    const table = fc.record({
      seats: fc.integer({ min: 2, max: 5 }),
      cards: fc.array(fc.constantFrom(...POOL), { minLength: 75, maxLength: 75 }),
      size: fc.integer({ min: 1, max: 5 }),
      seed: fc.string(),
    });
    fc.assert(
      fc.property(table, ({ seats, cards, size, seed }) => {
        let n = 0;
        const packs = Array.from({ length: seats }, () =>
          Array.from({ length: 3 }, () =>
            Array.from({ length: size }, () => cards[n++ % cards.length]),
          ),
        );
        let draft = conspiracyTable(packs);
        const at = { ...contextAt(61, seed), rng: seededRng(seed) };
        for (let guard = 0; guard < 500 && draft.status !== "finished"; guard += 1) {
          const acted = draft.seats
            .map((seat) =>
              actFor(
                draft,
                seat.seatNumber,
                at,
                (pack) => pack.cards.find((c) => c.pick === null)?.slot ?? 0,
              ),
            )
            .find((each) => each !== null);
          if (acted == null) break;
          draft = acted.draft;
        }
        expect(draft.status).toBe("finished");
        const everyCard = draft.packs.flatMap((pack) => pack.cards);
        expect(everyCard.every((each) => each.pick !== null)).toBe(true);
        const pooled = draft.seats.reduce(
          (sum, seat) => sum + poolOf(draft, seat.seatNumber).length,
          0,
        );
        expect(pooled).toBe(
          everyCard.filter(
            (each) => each.pick?.state === "faceDown" || each.pick?.state === "faceUp",
          ).length,
        );
      }),
      { numRuns: 150 },
    );
  });
});

// Keeps `atSecond` in use for readers looking for the clock used above.
void atSecond;

describe("edge cases from the rulings", () => {
  it("offers a Librarian's extra card only when the pack has one to give", () => {
    let draft = conspiracyTable([
      [["Cogwork Librarian", "Bear"], ["Elf", "Bolt"], ["Bear"]],
      [["Bear", "Bear"], ["Bear", "Bear"], ["Bear"]],
    ]);
    draft = pick(pick(draft, 0, "Cogwork Librarian"), 1, "Bear");
    // One card left in front of p0: drafting it leaves nothing for an extra card.
    expect(frontNames(draft, 0)).toEqual(["Bear"]);
    expect(visibleTo(draft, 0, ctx).you?.options.librarians).toBe(0);
    draft = pick(pick(draft, 0, "Bear"), 1, "Bear");
    expect(frontNames(draft, 0)).toEqual(["Elf", "Bolt"]);
    expect(visibleTo(draft, 0, ctx).you?.options.librarians).toBe(1);
  });

  it("a face-up Archdemon of Paliano stops you looking at packs: no Sneak, no peek at packs passed on", () => {
    let draft = conspiracyTable([
      [["Whispergear Sneak", "Archdemon of Paliano", "Bear", "Bear"], fillers(4), fillers(4)],
      [["Bear", "Leovold's Operative", "Bear", "Bear"], fillers(4), fillers(4)],
    ]);
    draft = pick(draft, 0, "Whispergear Sneak");
    draft = pick(draft, 1, "Bear");
    draft = pick(draft, 0, "Leovold's Operative"); // from p1's pack
    draft = pick(draft, 1, "Archdemon of Paliano"); // p1 now drafts blind
    const sneak = drafted(draft, 0, "Whispergear Sneak");
    expect(visibleTo(draft, 0, ctx).you?.options.sneak).not.toBeNull(); // p0 has no Archdemon
    expect(visibleTo(draft, 1, ctx).you?.pack?.cards).toBeNull();
    // Give p1 a skip: the pack they pass on is not shown to them.
    draft = withAbilities(draft, 1, (abilities) => ({ ...abilities, skipPacks: 1 }));
    draft = pick(draft, 0, "Bear"); // p0 passes 1 card to p1 … who must pass it on
    const passed = draft.reveals.filter((each) => each.audience === 1 && each.kind === "passedOn");
    expect(passed.at(-1)?.cards).toEqual([]);
    // And p0 can't peek either once they're blind.
    const blind = withCard(draft, drafted(draft, 1, "Archdemon of Paliano"), (each) =>
      each.pick === null ? each : { ...each, pick: { ...each.pick, seat: 0, poolSeat: 0 } },
    );
    const unopened = blind.packs.find((pack) => pack.round === 2)?.packNumber ?? -1;
    expect(peekAtPack(blind, 0, sneak, unopened, ctx)).toMatchObject({
      ok: false,
      error: { kind: "AbilityUnavailable" },
    });
  });
});
