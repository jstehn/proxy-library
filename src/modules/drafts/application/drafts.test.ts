import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { inMemoryEventRecorder } from "@/modules/activity/testing/fakes";
import { PrintingId, SetCode, type Color } from "@/modules/catalog";
import { inMemoryCollectionRepository } from "@/modules/collection/testing/fakes";
import { inMemoryCardLookup, inMemoryDeckRepository } from "@/modules/decks/testing/fakes";
import { inMemoryBoosterSource } from "@/modules/packs/testing/fakes";
import { SAMPLE_BOOSTER, SAMPLE_FACTS } from "@/modules/packs/testing/recipes";
import { inMemoryWalletServices } from "@/modules/wallet/testing/fakes";
import { Cents, UserId } from "@/shared/kernel";
import { inMemoryUnitOfWork, manualClock } from "@/shared/kernel/testing";
import type { DraftCardFacts } from "../domain/auto-pick";
import type { OwnedBasic } from "../domain/basics";
import { currentPack, poolOf, type Draft, type DraftId } from "../domain/draft";
import { inMemoryDraftCatalog, inMemoryDraftRepository, recordingNotifier } from "../testing/fakes";
import { makeDrafts } from "./drafts";
import { removeFromLobbies } from "./remove-from-lobbies";

function actor(id: string, isAdmin = false): Actor {
  return {
    userId: UserId.of(id),
    username: id as Actor["username"],
    displayName: id as Actor["displayName"],
    isAdmin,
    canSelfFund: false,
    mustChangePassword: false,
  };
}

const alice = actor("alice");
const bob = actor("bob");
const carol = actor("carol");
const broke = actor("broke");
const START = new Date("2026-10-02T18:00:00Z");
const FEE = 3 * 549;

/** The pack engine's sample cards, as the draft module sees them. */
const DRAFT_FACTS = new Map<PrintingId, DraftCardFacts>(
  [...SAMPLE_FACTS].map(([printingId, facts]) => [
    printingId,
    {
      name: facts.name,
      rarity: facts.rarity,
      colors: facts.colors,
      manaCost: `{2}${facts.colors.map((color) => `{${color}}`).join("")}`,
      manaValue: 2 + facts.colors.length,
      typeLine: facts.isBasicLand
        ? `Basic Land — ${facts.name === "l-island" ? "Island" : "Forest"}`
        : "Creature — Sample",
      producedMana: [],
      marketPrice: facts.marketPrice.nonfoil ?? null,
    },
  ]),
);

let clock: ReturnType<typeof manualClock>;
let wallet: ReturnType<typeof inMemoryWalletServices>;
let collection: ReturnType<typeof inMemoryCollectionRepository>;
let repository: ReturnType<typeof inMemoryDraftRepository>;
let catalog: ReturnType<typeof inMemoryDraftCatalog>;
let notifier: ReturnType<typeof recordingNotifier>;
let deckRepository: ReturnType<typeof inMemoryDeckRepository>;
let events: ReturnType<typeof inMemoryEventRecorder>;
let services: Parameters<typeof removeFromLobbies>[0];
let drafts: ReturnType<typeof makeDrafts>;
let seedsHandedOut: number;

/** Which basic land each basic printing in these tests is: the sample pack's and the catalog's. */
const BASIC_COLOR_OF: Readonly<Record<string, Color>> = {
  "l-forest": "G",
  "l-island": "U",
  "basic-plains": "W",
  "basic-island": "U",
  "basic-swamp": "B",
  "basic-mountain": "R",
  "basic-forest": "G",
};

/** The basics a player owns, read from the collection fake. */
function ownedBasicsOf(userId: UserId): Map<Color, OwnedBasic[]> {
  const owned = new Map<Color, OwnedBasic[]>();
  for (const [id, color] of Object.entries(BASIC_COLOR_OF)) {
    for (const finish of ["nonfoil", "foil"] as const) {
      const quantity = collection.quantity(userId, id, finish);
      if (quantity === 0) continue;
      owned.set(color, [
        ...(owned.get(color) ?? []),
        { printingId: PrintingId.of(id), finish, quantity },
      ]);
    }
  }
  return owned;
}

/** How many of one color's basics a player owns, every printing and finish. */
const basicsOwned = (userId: UserId, color: Color) =>
  (ownedBasicsOf(userId).get(color) ?? []).reduce((sum, copy) => sum + copy.quantity, 0);

beforeEach(async () => {
  clock = manualClock(START);
  wallet = inMemoryWalletServices(["alice", "bob", "carol", "broke"]);
  collection = inMemoryCollectionRepository();
  repository = inMemoryDraftRepository();
  catalog = inMemoryDraftCatalog(DRAFT_FACTS, ownedBasicsOf);
  notifier = recordingNotifier();
  deckRepository = inMemoryDeckRepository();
  events = inMemoryEventRecorder();
  const knownCards = [...SAMPLE_FACTS.keys(), ...catalog.basicPrintings].map((id) => ({
    oracleId: `oracle-${id}`,
    name: id,
    printingId: id,
  }));
  services = {
    ...wallet.services,
    drafts: repository,
    draftCatalog: catalog,
    draftNotifier: notifier,
    collection,
    boosters: inMemoryBoosterSource([SAMPLE_BOOSTER], SAMPLE_FACTS),
    decks: deckRepository,
    cards: inMemoryCardLookup(knownCards),
    events,
  };
  seedsHandedOut = 0;
  drafts = makeDrafts({
    unitOfWork: inMemoryUnitOfWork(services),
    clock,
    seeds: { newSeed: () => `seed-${++seedsHandedOut}` },
  });
  for (const player of [alice, bob, carol, broke]) {
    await wallet.services.wallets.openAccountIfMissing({
      userId: player.userId,
      allowancePaidThrough: START,
      openedAt: START,
    });
    if (player === broke) continue;
    await wallet.services.wallets.appendEntries([
      {
        userId: player.userId,
        amount: Cents.of(5000),
        kind: "grant",
        note: null,
        createdBy: null,
        effectiveAt: START,
        ref: null,
      },
    ]);
  }
});

const balance = (player: Actor) => wallet.services.wallets.balance(player.userId);
const draftOf = (draftId: DraftId): Draft => {
  const draft = repository.get(draftId);
  if (draft === undefined) throw new Error("no such draft");
  return draft;
};

async function host(secondsPerPick: number | null = 90): Promise<DraftId> {
  const created = await drafts.createDraft(alice, {
    setCode: SetCode.of("TST"),
    boosterType: "play",
    maxSeats: 8,
    secondsPerPick,
  });
  if (!created.ok) throw new Error(created.error.kind);
  return created.value;
}

/** Alice hosts, Bob joins, Alice starts. */
async function twoPlayerDraft(secondsPerPick: number | null = 90): Promise<DraftId> {
  const draftId = await host(secondsPerPick);
  expect(await drafts.joinDraft(bob, draftId)).toEqual({ ok: true, value: undefined });
  expect(await drafts.startDraft(alice, draftId)).toEqual({ ok: true, value: undefined });
  return draftId;
}

/** The seat's front pack and its first card left. */
function firstChoice(draftId: DraftId, player: Actor) {
  const draft = draftOf(draftId);
  const seat = draft.seats.find((each) => each.userId === player.userId);
  const pack = seat === undefined ? null : currentPack(draft, seat.seatNumber);
  if (pack === null) return null;
  const card = pack.cards.find((each) => each.pick === null);
  return card === undefined ? null : { draftId, packNumber: pack.packNumber, slot: card.slot };
}

describe("hosting and joining", () => {
  it("charges the entry fee (3 packs at MSRP) to the host and each player who joins", async () => {
    const draftId = await host();
    expect(await balance(alice)).toBe(5000 - FEE);
    expect(draftOf(draftId).entryFee).toBe(FEE);
    await drafts.joinDraft(bob, draftId);
    await drafts.joinDraft(bob, draftId); // twice: charged once
    expect(await balance(bob)).toBe(5000 - FEE);
    expect(wallet.services.wallets.entriesFor(bob.userId).at(-1)).toMatchObject({
      kind: "draft_entry",
      ref: `draft:${draftId}`,
      note: "Test Set draft",
    });
    expect(notifier.sent.at(-1)).toEqual({ draftId, version: 2 });
  });

  it("refuses a player who can't pay, without seating them", async () => {
    const draftId = await host();
    expect(await drafts.joinDraft(broke, draftId)).toMatchObject({
      ok: false,
      error: { kind: "InsufficientFunds" },
    });
    expect(draftOf(draftId).seats.map((seat) => seat.userId)).toEqual(["alice"]);
  });

  it("allows one unfinished draft per player (rule 1)", async () => {
    const draftId = await host();
    const second = await drafts.createDraft(alice, {
      setCode: SetCode.of("TST"),
      boosterType: "play",
      maxSeats: 4,
      secondsPerPick: null,
    });
    expect(second).toEqual({ ok: false, error: { kind: "AlreadyInADraft", draftId } });
  });

  it("checks the booster, its price, the seats and the timer", async () => {
    const input = {
      setCode: SetCode.of("TST"),
      boosterType: "play",
      maxSeats: 8,
      secondsPerPick: 90,
    };
    expect(await drafts.createDraft(alice, { ...input, boosterType: "collector" })).toEqual({
      ok: false,
      error: { kind: "BoosterNotDraftable" },
    });
    expect((await drafts.createDraft(alice, { ...input, maxSeats: 9 })).ok).toBe(false);
    expect((await drafts.createDraft(alice, { ...input, secondsPerPick: 5 })).ok).toBe(false);
    catalog.removePrice("TST", "play");
    expect(await drafts.createDraft(alice, input)).toEqual({
      ok: false,
      error: { kind: "PriceUnavailable" },
    });
  });

  it("refunds a player who leaves, and everyone when the host leaves (rule 2)", async () => {
    const draftId = await host();
    await drafts.joinDraft(bob, draftId);
    await drafts.joinDraft(carol, draftId);
    await drafts.leaveDraft(bob, draftId);
    expect(await balance(bob)).toBe(5000);
    await drafts.leaveDraft(alice, draftId);
    expect(draftOf(draftId).status).toBe("cancelled");
    expect([await balance(alice), await balance(carol)]).toEqual([5000, 5000]);
    // Bob was already refunded and gone: no second refund.
    expect(await balance(bob)).toBe(5000);
  });
});

describe("starting", () => {
  it("only the host starts, with two players or more", async () => {
    const draftId = await host();
    expect(await drafts.startDraft(alice, draftId)).toEqual({
      ok: false,
      error: { kind: "TooFewPlayers", minimum: 2 },
    });
    await drafts.joinDraft(bob, draftId);
    expect(await drafts.startDraft(bob, draftId)).toEqual({
      ok: false,
      error: { kind: "NotHost" },
    });
    expect((await drafts.startDraft(alice, draftId)).ok).toBe(true);
    const draft = draftOf(draftId);
    expect(draft.status).toBe("drafting");
    expect(draft.packs.map((pack) => pack.seed)).toEqual([
      "seed-1",
      "seed-4",
      "seed-2",
      "seed-5",
      "seed-3",
      "seed-6",
    ]);
    // The basics left the packs and were dealt out, one each give or take one (rule 15).
    const isBasic = (id: string) => id in BASIC_COLOR_OF;
    expect(draft.packs.every((pack) => pack.cards.every((card) => !isBasic(card.printingId)))).toBe(
      true,
    );
    const cardsInPacks = draft.packs.reduce((sum, pack) => sum + pack.cards.length, 0);
    expect(cardsInPacks + draft.basicsHandedOut.length).toBe(6 * 14);
    const dealt = [alice, bob].map(
      (player) => draft.basicsHandedOut.filter((basic) => basic.userId === player.userId).length,
    );
    expect(Math.abs(dealt[0] - dealt[1])).toBeLessThanOrEqual(1);
    expect(collection.quantity(alice.userId, "l-forest", "nonfoil")).toBeGreaterThan(0);
  });
});

describe("picking", () => {
  it("puts each pick in the player's collection straight away (rule 8)", async () => {
    const draftId = await twoPlayerDraft();
    const choice = firstChoice(draftId, alice);
    if (choice === null) throw new Error("nothing to pick");
    expect(await drafts.makePick(alice, choice)).toEqual({ ok: true, value: undefined });
    expect(collection.log.at(-1)).toMatchObject({
      userId: "alice",
      source: "draft",
      ref: `draft:${draftId}`,
    });
    // The same pick again is stale, and changes nothing.
    expect(await drafts.makePick(alice, choice)).toEqual({
      ok: false,
      error: { kind: "StalePick" },
    });
    expect(await drafts.makePick(carol, choice)).toEqual({
      ok: false,
      error: { kind: "NotSeated" },
    });
  });

  it("drafts to the end, then gives everyone a draft deck and tells the feed (rules 7 and 12)", async () => {
    const draftId = await twoPlayerDraft();
    for (let turn = 0; turn < 200 && draftOf(draftId).status === "drafting"; turn += 1) {
      for (const player of [alice, bob]) {
        const choice = firstChoice(draftId, player);
        if (choice !== null) await drafts.makePick(player, choice);
      }
    }
    const draft = draftOf(draftId);
    expect(draft.status).toBe("finished");
    const pool = poolOf(draft, 0).length;
    expect(pool + poolOf(draft, 1).length + draft.basicsHandedOut.length).toBe(84);

    for (const player of [alice, bob]) {
      const deckId = repository.deckOf(draftId, player.userId);
      const deck = deckId === undefined ? undefined : deckRepository.get(deckId);
      expect(deck?.format).toBe("limited");
      expect(deck?.name).toBe("Test Set draft, 2 Oct");
      const main = (deck?.entries ?? []).filter((entry) => entry.board === "main");
      const side = (deck?.entries ?? []).filter((entry) => entry.board === "side");
      expect(main.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(40);
      expect(side.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(
        poolOf(draft, player === alice ? 0 : 1).length - 23,
      );
      // Its basics are ones the player owns: dealt from the packs, or given for free (rule 17).
      for (const entry of main) {
        const color = BASIC_COLOR_OF[entry.oracleId.replace("oracle-", "")];
        if (color === undefined) continue;
        expect(basicsOwned(player.userId, color)).toBeGreaterThanOrEqual(entry.quantity);
      }
    }
    expect(events.recorded.map(({ event }) => event)).toEqual([
      { kind: "draft", actorId: "alice", setName: "Test Set", players: 2 },
    ]);
    // Every change was announced, with versions going up.
    const versions = notifier.sent.map((sent) => sent.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(versions.at(-1)).toBe(draft.version);
  });
});

describe("the pick timer", () => {
  it("auto-picks for a player who is here but doesn't pick", async () => {
    const draftId = await twoPlayerDraft();
    clock.advanceBy(60_000);
    await drafts.markPresence(alice, draftId, true);
    await drafts.markPresence(bob, draftId, true);
    clock.advanceBy(30_000);
    expect(await drafts.runTimers()).toEqual({ drafts: 1, autoPicks: 2, extensions: 0 });
    const draft = draftOf(draftId);
    expect(poolOf(draft, 0).map((card) => card.pick?.auto)).toEqual([true]);
    // The auto-picked card went into the collection like any other.
    const [autoPicked] = poolOf(draft, 0);
    expect(collection.quantity(alice.userId, autoPicked.printingId, autoPicked.finish)).toBe(
      1 +
        draft.basicsHandedOut.filter((basic) => basic.printingId === autoPicked.printingId).length,
    );
  });

  it("gives an away player grace first", async () => {
    const draftId = await twoPlayerDraft();
    clock.advanceBy(90_000);
    expect(await drafts.runTimers()).toEqual({ drafts: 1, autoPicks: 0, extensions: 2 });
    expect(draftOf(draftId).seats.map((seat) => seat.graceUsedSeconds)).toEqual([120, 120]);
  });

  it("does nothing with the timer off; the host can pick for someone who has gone", async () => {
    const draftId = await twoPlayerDraft(null);
    clock.advanceBy(3_600_000);
    expect(await drafts.runTimers()).toEqual({ drafts: 0, autoPicks: 0, extensions: 0 });
    expect(await drafts.pickForAway(bob, { draftId, seatNumber: 0 })).toEqual({
      ok: false,
      error: { kind: "NotHost" },
    });
    expect(await drafts.pickForAway(alice, { draftId, seatNumber: 1 })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(poolOf(draftOf(draftId), 1)).toHaveLength(1);
  });
});

describe("presence", () => {
  it("ignores watchers who aren't seated, and announces here/away changes only", async () => {
    const draftId = await host();
    const sent = notifier.sent.length;
    await drafts.markPresence(carol, draftId, true);
    expect(notifier.sent.length).toBe(sent);
    await drafts.markPresence(alice, draftId, true);
    await drafts.markPresence(alice, draftId, true);
    expect(notifier.sent.length).toBe(sent + 1);
  });
});

describe("making the deck again", () => {
  it("works only once the draft is finished", async () => {
    const draftId = await twoPlayerDraft();
    expect(await drafts.makeDraftDeck(alice, draftId)).toEqual({
      ok: false,
      error: { kind: "DraftNotFinished" },
    });
  });
});

describe("removeFromLobbies (a reset)", () => {
  it("takes the player out of lobbies with a refund, and leaves running drafts alone", async () => {
    const lobby = await host();
    await drafts.joinDraft(bob, lobby);
    expect(await removeFromLobbies(services, bob.userId, clock.now())).toBe(1);
    expect(draftOf(lobby).seats.map((seat) => seat.userId)).toEqual(["alice"]);
    expect(await balance(bob)).toBe(5000);

    await drafts.joinDraft(bob, lobby);
    await drafts.startDraft(alice, lobby);
    expect(await removeFromLobbies(services, bob.userId, clock.now())).toBe(0);
    expect(draftOf(lobby).seats).toHaveLength(2);
  });
});

describe("drafting with bots (an admin's test, rule 16)", () => {
  const admin = actor("alice", true);

  it("lets an admin host fill seats with bots, paying their fees", async () => {
    const draftId = await host();
    expect(await drafts.addBot(bob, draftId)).toEqual({
      ok: false,
      error: { kind: "BotsForAdminsOnly" },
    });
    expect(await drafts.addBot(admin, draftId)).toEqual({ ok: true, value: undefined });
    expect(await drafts.addBot(admin, draftId)).toEqual({ ok: true, value: undefined });
    expect(await balance(alice)).toBe(5000 - 3 * FEE);
    expect(wallet.services.wallets.entriesFor(alice.userId).at(-1)?.note).toBe(
      "Test Set draft (Bot 2)",
    );

    expect(await drafts.removeBot(admin, { draftId, botNumber: 2 })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await balance(alice)).toBe(5000 - 2 * FEE);
  });

  it("drafts alone to the end: bots pick at once, and their cards go to the admin", async () => {
    const draftId = await host();
    await drafts.addBot(admin, draftId);
    await drafts.addBot(admin, draftId);
    expect((await drafts.startDraft(admin, draftId)).ok).toBe(true);

    for (let turn = 0; turn < 100 && draftOf(draftId).status === "drafting"; turn += 1) {
      const choice = firstChoice(draftId, alice);
      if (choice === null) throw new Error("the bots should never keep Alice waiting");
      await drafts.makePick(admin, choice);
    }
    const draft = draftOf(draftId);
    expect(draft.status).toBe("finished");
    expect(draft.packs.flatMap((pack) => pack.cards).every((card) => card.pick !== null)).toBe(
      true,
    );
    expect(poolOf(draft, 1).every((card) => card.pick?.auto)).toBe(true);

    // Every card, the bots' picks and all the dealt basics, is now Alice's.
    const received = collection.log
      .filter((entry) => entry.userId === alice.userId && entry.ref === `draft:${draftId}`)
      .flatMap((entry) => entry.gains);
    const count = (gains: typeof received) => gains.reduce((sum, gain) => sum + gain.quantity, 0);
    // Free basics for the deck are the catalog's printings ("basic-…"); dealt ones came in packs.
    const free = received.filter((gain) => gain.printingId.startsWith("basic-"));
    const fromPacks = draft.packs.reduce((sum, pack) => sum + pack.cards.length, 0);
    expect(count(received) - count(free)).toBe(fromPacks + draft.basicsHandedOut.length);
    expect(draft.basicsHandedOut.every((basic) => basic.userId === alice.userId)).toBe(true);

    // One deck, Alice's; and the feed stays quiet about a test.
    expect(repository.deckOf(draftId, alice.userId)).toBeDefined();
    expect(events.recorded).toEqual([]);
  });
});
