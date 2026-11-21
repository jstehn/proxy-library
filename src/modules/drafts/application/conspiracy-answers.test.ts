import { testActor } from "@/modules/accounts/testing/actors";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { inMemoryEventRecorder } from "@/modules/activity/testing/fakes";
import { inMemoryCollectionRepository } from "@/modules/collection/game/testing/fakes";
import { inMemoryCardLookup, inMemoryDeckRepository } from "@/modules/decks/core/testing/fakes";
import { inMemoryItemRepository } from "@/modules/inventory/testing/fakes";
import { inMemoryBoosterSource } from "@/modules/packs/testing/fakes";
import { SAMPLE_BOOSTER, SAMPLE_FACTS } from "@/modules/packs/testing/recipes";
import { inMemoryWalletServices } from "@/modules/wallet/testing/fakes";
import { inMemoryUnitOfWork, manualClock } from "@/shared/kernel/testing";
import type { PrintingId } from "@/modules/catalog";
import type { DraftCardFacts } from "../domain/auto-pick";
import type { CardRef } from "../domain/abilities";
import { currentPack, refOf, type Draft, type DraftId } from "../domain/draft";
import { atSecond, conspiracyTable, contextAt, fillers, nameOf } from "../testing/conspiracy";
import { inMemoryDraftCatalog, inMemoryDraftRepository, recordingNotifier } from "../testing/fakes";
import { makeDrafts } from "./drafts";

// The use cases that answer a conspiracy card's follow-up questions (design doc 18): the choices
// about a card drawn at random (Archdemon of Paliano) and a Deal Broker step. The rules
// themselves are tested in domain/conspiracy.test.ts; these check who may answer, and what is saved.

const alice: Actor = testActor({ name: "alice" });
const bob: Actor = testActor({ name: "bob" });
const carol: Actor = testActor({ name: "carol" });

let repository: ReturnType<typeof inMemoryDraftRepository>;
let notifier: ReturnType<typeof recordingNotifier>;
let drafts: ReturnType<typeof makeDrafts>;

/** Saves a table of named cards as a draft: alice is seat 0, bob seat 1. */
async function seatedTable(packs: ReadonlyArray<ReadonlyArray<readonly string[]>>): Promise<{
  draftId: DraftId;
  draft: () => Draft;
}> {
  const table = conspiracyTable(packs, { players: ["alice", "bob"] });
  const draftId = await repository.create(table);
  const facts = new Map<PrintingId, DraftCardFacts>();
  for (const pack of table.packs) {
    for (const card of pack.cards) {
      const found = contextAt().cards(card.printingId);
      if (found !== undefined) facts.set(card.printingId, found);
    }
  }
  const catalog = inMemoryDraftCatalog(facts);
  const wallet = inMemoryWalletServices(["alice", "bob"]);
  const knownCards = [...facts.keys()].map((id) => ({
    oracleId: `oracle-${nameOf(id)}`,
    name: nameOf(id),
    printingId: id,
  }));
  let seeds = 0;
  drafts = makeDrafts({
    unitOfWork: inMemoryUnitOfWork({
      ...wallet.services,
      drafts: repository,
      draftCatalog: catalog,
      draftNotifier: notifier,
      collection: inMemoryCollectionRepository(),
      boosters: inMemoryBoosterSource([SAMPLE_BOOSTER], SAMPLE_FACTS),
      decks: inMemoryDeckRepository(),
      items: inMemoryItemRepository(),
      cards: inMemoryCardLookup(knownCards),
      events: inMemoryEventRecorder(),
    }),
    clock: manualClock(atSecond(61)),
    seeds: { newSeed: () => `seed-${++seeds}` },
  });
  return {
    draftId,
    draft: () => {
      const saved = repository.get(draftId);
      if (saved === undefined) throw new Error("no such draft");
      return saved;
    },
  };
}

/** Drafts the first card with this name from the pack in front of the player's seat. */
async function draftByName(draftId: DraftId, player: Actor, seat: number, name: string) {
  const draft = repository.get(draftId);
  const pack = draft === undefined ? null : currentPack(draft, seat);
  const card = pack?.cards.find((each) => each.pick === null && nameOf(each.printingId) === name);
  if (pack === null || card === undefined) throw new Error(`no ${name} in front of seat ${seat}`);
  const picked = await drafts.makePick(player, {
    draftId,
    packNumber: pack.packNumber,
    slot: card.slot,
  });
  expect(picked).toEqual({ ok: true, value: undefined });
}

/** Where a seat's drafted card with this name is. */
function draftedRef(draft: Draft, seat: number, name: string): CardRef {
  for (const pack of draft.packs) {
    const found = pack.cards.find(
      (card) => card.pick?.seat === seat && nameOf(card.printingId) === name,
    );
    if (found !== undefined) return refOf(pack, found);
  }
  throw new Error(`seat ${seat} hasn't drafted ${name}`);
}

beforeEach(() => {
  repository = inMemoryDraftRepository();
  notifier = recordingNotifier();
});

describe("decideCard (a card drawn at random)", () => {
  /** Alice has the Archdemon face up and has drawn her next card at random. */
  async function drawnAtRandom() {
    const table = await seatedTable([
      [["Archdemon of Paliano", "Bear", "Bear"], fillers(3), fillers(3)],
      [fillers(3), fillers(3), fillers(3)],
    ]);
    await draftByName(table.draftId, alice, 0, "Archdemon of Paliano");
    await draftByName(table.draftId, bob, 1, "Bear");
    const front = currentPack(table.draft(), 0);
    const drawn = await drafts.makePick(alice, {
      draftId: table.draftId,
      packNumber: front?.packNumber ?? -1,
      slot: "random",
    });
    expect(drawn).toEqual({ ok: true, value: undefined });
    return table;
  }

  it("clears the card that was waiting for choices, saves the draft and tells watchers", async () => {
    const table = await drawnAtRandom();
    expect(table.draft().seats[0].abilities.awaitingChoices).not.toBeNull();
    const versionBefore = table.draft().version;
    const notificationsBefore = notifier.sent.length;

    const decided = await drafts.decideCard(alice, { draftId: table.draftId, choices: {} });

    expect(decided).toEqual({ ok: true, value: undefined });
    expect(table.draft().seats[0].abilities.awaitingChoices).toBeNull();
    expect(table.draft().version).toBeGreaterThan(versionBefore);
    expect(notifier.sent.length).toBeGreaterThan(notificationsBefore);
  });

  it("refuses a second answer: the card is already decided", async () => {
    const table = await drawnAtRandom();
    await drafts.decideCard(alice, { draftId: table.draftId, choices: {} });
    const versionAfterFirst = table.draft().version;

    const again = await drafts.decideCard(alice, { draftId: table.draftId, choices: {} });

    expect(again).toMatchObject({ ok: false, error: { kind: "AbilityUnavailable" } });
    expect(table.draft().version).toBe(versionAfterFirst);
  });

  it("refuses a player whose card isn't waiting, someone who isn't seated, and a missing draft", async () => {
    const table = await drawnAtRandom();
    expect(await drafts.decideCard(bob, { draftId: table.draftId, choices: {} })).toMatchObject({
      ok: false,
      error: { kind: "AbilityUnavailable" },
    });
    expect(await drafts.decideCard(carol, { draftId: table.draftId, choices: {} })).toEqual({
      ok: false,
      error: { kind: "NotSeated" },
    });
    expect(await drafts.decideCard(alice, { draftId: 999 as DraftId, choices: {} })).toEqual({
      ok: false,
      error: { kind: "DraftNotFound" },
    });
    expect(table.draft().seats[0].abilities.awaitingChoices).not.toBeNull();
  });
});

describe("answerDeal (Deal Broker, right after the draft)", () => {
  /** Alice holds the Deal Broker; the draft has just ended and her deal waits for a reveal. */
  async function dealing() {
    const table = await seatedTable([
      [["Deal Broker"], ["Bear"], ["Bear"]],
      [["Elf"], ["Bolt"], ["Bear"]],
    ]);
    for (const round of [1, 2, 3]) {
      await draftByName(table.draftId, alice, 0, round === 1 ? "Deal Broker" : "Bear");
      const front = currentPack(table.draft(), 1)?.cards.find((card) => card.pick === null);
      await draftByName(table.draftId, bob, 1, nameOf(front?.printingId ?? ""));
    }
    expect(table.draft().status).toBe("dealing");
    return table;
  }

  it("plays a deal through: the broker reveals, the other offers, the broker accepts and pools swap", async () => {
    const table = await dealing();
    const bear = draftedRef(table.draft(), 0, "Bear");
    const bolt = draftedRef(table.draft(), 1, "Bolt");

    expect(
      await drafts.answerDeal(alice, { draftId: table.draftId, step: "reveal", card: bear }),
    ).toEqual({ ok: true, value: undefined });
    expect(table.draft().deals?.current?.stage).toBe("offers");

    expect(
      await drafts.answerDeal(bob, { draftId: table.draftId, step: "offer", card: bolt }),
    ).toEqual({ ok: true, value: undefined });
    expect(table.draft().deals?.current?.stage).toBe("accept");

    expect(
      await drafts.answerDeal(alice, { draftId: table.draftId, step: "accept", offerSeat: 1 }),
    ).toEqual({ ok: true, value: undefined });
    expect(table.draft().status).toBe("finished");
    const poolOf = (seat: number) =>
      table
        .draft()
        .packs.flatMap((pack) => pack.cards)
        .filter((card) => card.pick?.poolSeat === seat)
        .map((card) => nameOf(card.printingId));
    expect(poolOf(0)).toContain("Bolt");
    expect(poolOf(1)).toContain("Bear");
  });

  it("lets the broker make no deal, which ends the draft", async () => {
    const table = await dealing();
    expect(
      await drafts.answerDeal(alice, { draftId: table.draftId, step: "reveal", card: null }),
    ).toEqual({ ok: true, value: undefined });
    expect(table.draft().status).toBe("finished");
  });

  it("refuses answers that aren't yours or aren't due: not the broker, too early, a card you don't hold", async () => {
    const table = await dealing();
    const bear = draftedRef(table.draft(), 0, "Bear");
    const bolt = draftedRef(table.draft(), 1, "Bolt");
    const refused = { ok: false, error: { kind: "NothingToAnswer" } };

    // Not your deal: only the broker reveals, and offers wait for the reveal.
    expect(
      await drafts.answerDeal(bob, { draftId: table.draftId, step: "reveal", card: bolt }),
    ).toEqual(refused);
    expect(
      await drafts.answerDeal(bob, { draftId: table.draftId, step: "offer", card: bolt }),
    ).toEqual(refused);
    expect(
      await drafts.answerDeal(alice, { draftId: table.draftId, step: "accept", offerSeat: 1 }),
    ).toEqual(refused);
    // Someone who isn't seated, and a card that isn't in the broker's pool.
    expect(
      await drafts.answerDeal(carol, { draftId: table.draftId, step: "reveal", card: bear }),
    ).toEqual({ ok: false, error: { kind: "NotSeated" } });
    expect(
      await drafts.answerDeal(alice, { draftId: table.draftId, step: "reveal", card: bolt }),
    ).toMatchObject({ ok: false, error: { kind: "AbilityUnavailable" } });
    expect(table.draft().deals?.current?.stage).toBe("reveal");
  });

  it("refuses a second offer from the same player and a reveal after the stage has passed", async () => {
    const table = await dealing();
    const bear = draftedRef(table.draft(), 0, "Bear");
    const bolt = draftedRef(table.draft(), 1, "Bolt");
    await drafts.answerDeal(alice, { draftId: table.draftId, step: "reveal", card: bear });
    await drafts.answerDeal(bob, { draftId: table.draftId, step: "offer", card: bolt });

    expect(
      await drafts.answerDeal(bob, { draftId: table.draftId, step: "offer", card: null }),
    ).toEqual({ ok: false, error: { kind: "NothingToAnswer" } });
    expect(
      await drafts.answerDeal(alice, { draftId: table.draftId, step: "reveal", card: bear }),
    ).toEqual({ ok: false, error: { kind: "NothingToAnswer" } });
  });
});
