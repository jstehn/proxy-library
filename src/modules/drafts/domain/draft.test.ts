import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import { samplePacks, sampleLobby, samplePrintingId, START } from "../testing/samples";
import {
  addBot,
  applyPick,
  checkCanStart,
  checkSeats,
  checkTimer,
  currentPack,
  joinDraft,
  leaveDraft,
  poolOf,
  queueOf,
  removeBot,
  seatOf,
  startDraft,
  type Draft,
} from "./draft";
import { passTarget } from "./style";

const at = (seconds: number) => new Date(START.getTime() + seconds * 1000);
const alice = UserId.of("alice");
const bob = UserId.of("bob");

/** The value of an ok result; a test failure for an error. */
function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { kind: string } }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.kind}`);
  return result.value;
}

function started(players: string[], size = 3, timer?: Draft["timer"]): Draft {
  const lobby = sampleLobby(players, { timer });
  return startDraft(lobby, samplePacks(players.length, 3, size), at(60));
}

/** Picks the first card left in the seat's front pack. */
function pickFirst(draft: Draft, seatNumber: number, when = at(61)): Draft {
  const pack = currentPack(draft, seatNumber);
  if (pack === null) throw new Error(`seat ${seatNumber} has nothing to pick`);
  const slot = pack.cards.find((card) => card.pick === null)?.slot ?? -1;
  return unwrap(
    applyPick(draft, { seatNumber, packNumber: pack.packNumber, slot, auto: false }, when),
  ).draft;
}

describe("settings", () => {
  it("allows 2–8 seats and a timer of 30–300 seconds or none", () => {
    expect(checkSeats(2).ok && checkSeats(8).ok).toBe(true);
    expect(checkSeats(1)).toEqual({
      ok: false,
      error: { kind: "SeatsInvalid", minimum: 2, maximum: 8 },
    });
    expect(checkSeats(9).ok).toBe(false);
    expect(checkTimer(null)).toEqual({ ok: true, value: { kind: "off" } });
    expect(checkTimer(90)).toEqual({ ok: true, value: { kind: "on", secondsPerPick: 90 } });
    expect(checkTimer(29).ok || checkTimer(301).ok || checkTimer(45.5).ok).toBe(false);
  });
});

describe("the lobby", () => {
  it("seats players until it's full, and joining twice changes nothing", () => {
    const lobby = sampleLobby(["alice", "bob"], { maxSeats: 2 });
    expect(lobby.seats.map((seat) => [seat.userId, seat.seatNumber])).toEqual([
      ["alice", 0],
      ["bob", 1],
    ]);
    expect(joinDraft(lobby, UserId.of("carol"), at(5))).toEqual({
      ok: false,
      error: { kind: "DraftFull", maxSeats: 2 },
    });
    expect(joinDraft(lobby, bob, at(5))).toEqual({ ok: true, value: lobby });
  });

  it("refunds a player who leaves, and everyone when the host leaves (rule 2)", () => {
    const lobby = sampleLobby(["alice", "bob", "carol"]);
    const bobLeaves = leaveDraft(lobby, bob);
    expect(bobLeaves.ok && bobLeaves.value.refunds).toEqual([{ userId: bob, amount: 1647 }]);
    expect(bobLeaves.ok && bobLeaves.value.draft.seats.map((seat) => seat.userId)).toEqual([
      "alice",
      "carol",
    ]);

    const hostLeaves = leaveDraft(lobby, alice);
    expect(hostLeaves.ok && hostLeaves.value.draft.status).toBe("cancelled");
    expect(hostLeaves.ok && hostLeaves.value.refunds.map((refund) => refund.userId)).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
  });

  it("only lets the host start, with at least two players (rule 3)", () => {
    expect(checkCanStart(sampleLobby(["alice"]), alice)).toEqual({
      ok: false,
      error: { kind: "TooFewPlayers", minimum: 2 },
    });
    const lobby = sampleLobby(["alice", "bob"]);
    expect(checkCanStart(lobby, bob)).toEqual({ ok: false, error: { kind: "NotHost" } });
    expect(checkCanStart(lobby, alice).ok).toBe(true);
    const running = startDraft(lobby, samplePacks(2, 3), at(60));
    expect(checkCanStart(running, alice)).toEqual({ ok: false, error: { kind: "DraftNotOpen" } });
    expect(joinDraft(running, UserId.of("carol"), at(61)).ok).toBe(false);
    expect(leaveDraft(running, bob)).toEqual({ ok: false, error: { kind: "DraftNotOpen" } });
  });
});

describe("starting", () => {
  it("renumbers seats in join order and puts each round-1 pack in front of its opener", () => {
    const lobby = unwrap(leaveDraft(sampleLobby(["alice", "bob", "carol"]), bob)).draft;
    const draft = startDraft(lobby, samplePacks(2, 3), at(60));
    expect(draft.status).toBe("drafting");
    expect(draft.round).toBe(1);
    expect(draft.seats.map((seat) => [seat.userId, seat.seatNumber])).toEqual([
      ["alice", 0],
      ["carol", 1],
    ]);
    expect(currentPack(draft, 0)?.cards[0].printingId).toBe("s0r1c0");
    expect(currentPack(draft, 1)?.cards[0].printingId).toBe("s1r1c0");
    expect(draft.packs).toHaveLength(6);
  });
});

describe("passing", () => {
  it("passes left in rounds 1 and 3 and right in round 2", () => {
    expect(passTarget(0, "left", 4)).toBe(1);
    expect(passTarget(3, "left", 4)).toBe(0);
    expect(passTarget(0, "right", 4)).toBe(3);
    expect(passTarget(1, "right", 2)).toBe(0);
  });

  it("queues packs at a slow seat while a fast seat waits (rules 5 and 6)", () => {
    let draft = started(["alice", "bob", "carol"]);
    draft = pickFirst(draft, 0); // alice's pack goes to bob
    expect(currentPack(draft, 0)).toBeNull(); // alice waits for carol
    expect(queueOf(draft, 1).map((pack) => pack.openedBySeat)).toEqual([1, 0]);
    draft = pickFirst(draft, 1); // bob picks from his own pack first
    expect(queueOf(draft, 1).map((pack) => pack.openedBySeat)).toEqual([0]);
    expect(queueOf(draft, 2).map((pack) => pack.openedBySeat)).toEqual([2, 1]);
  });

  it("rejects a pick from a pack that isn't in front, or a card already taken (StalePick)", () => {
    let draft = started(["alice", "bob"]);
    const front = currentPack(draft, 0);
    if (front === null) throw new Error("no pack");
    const first = { seatNumber: 0, packNumber: front.packNumber, slot: 0, auto: false };
    draft = unwrap(applyPick(draft, first, at(61))).draft;
    expect(applyPick(draft, first, at(62))).toEqual({ ok: false, error: { kind: "StalePick" } });
    const bobsPack = currentPack(draft, 1);
    expect(bobsPack?.packNumber).toBe(1);
    expect(
      applyPick(draft, { seatNumber: 1, packNumber: 1, slot: 99, auto: false }, at(62)),
    ).toEqual({ ok: false, error: { kind: "StalePick" } });
  });

  it("moves to the next round when a round's packs are empty, then finishes (rule 7)", () => {
    let draft = started(["alice", "bob"], 2);
    // Round 1: two picks each empties both 2-card packs.
    draft = pickFirst(pickFirst(draft, 0), 1);
    expect(draft.round).toBe(1);
    draft = pickFirst(pickFirst(draft, 0), 1);
    expect(draft.round).toBe(2);
    for (let i = 0; i < 4; i += 1) draft = pickFirst(pickFirst(draft, 0), 1);
    expect(draft.status).toBe("finished");
    expect(draft.finishedAt).toEqual(at(61));
    expect(poolOf(draft, 0)).toHaveLength(6);
    expect(poolOf(draft, 0).map((card) => card.pick?.pickNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      applyPick(draft, { seatNumber: 0, packNumber: 0, slot: 0, auto: false }, at(70)),
    ).toEqual({ ok: false, error: { kind: "DraftNotRunning" } });
  });

  it("skips packs that came out empty", () => {
    const lobby = sampleLobby(["alice", "bob"]);
    const draft = startDraft(
      lobby,
      samplePacks(2, 3, (_, round) => (round === 1 ? 0 : 2)),
      at(60),
    );
    expect(draft.round).toBe(2);
  });
});

describe("any table, any order of picks", () => {
  it("picks every card exactly once, only from the front of a queue, and finishes", () => {
    const table = fc.record({
      seats: fc.integer({ min: 2, max: 8 }),
      sizes: fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 24, maxLength: 24 }),
      choices: fc.array(fc.nat(), { minLength: 400, maxLength: 400 }),
    });
    fc.assert(
      fc.property(table, ({ seats, sizes, choices }) => {
        const players = Array.from({ length: seats }, (_, index) => `p${index}`);
        const packs = samplePacks(seats, 3, (seat, round) => sizes[(round - 1) * 8 + seat]);
        let draft = startDraft(sampleLobby(players), packs, at(60));
        const totalCards = packs.flat().reduce((sum, pack) => sum + pack.cards.length, 0);

        for (const choice of choices) {
          if (draft.status === "finished") break;
          // Somebody always has a pack while the draft runs.
          const waiting = draft.seats.filter(
            (seat) => currentPack(draft, seat.seatNumber) !== null,
          );
          expect(waiting.length).toBeGreaterThan(0);
          const seat = waiting[choice % waiting.length].seatNumber;
          const front = currentPack(draft, seat);
          if (front === null) throw new Error("unreachable");
          const left = front.cards.filter((card) => card.pick === null);
          const card = left[choice % left.length];
          // A pack further back in the queue is never pickable.
          for (const behind of queueOf(draft, seat).slice(1)) {
            const tried = applyPick(
              draft,
              {
                seatNumber: seat,
                packNumber: behind.packNumber,
                slot: behind.cards[0].slot,
                auto: false,
              },
              at(61),
            );
            expect(tried.ok).toBe(false);
          }
          const picked = applyPick(
            draft,
            { seatNumber: seat, packNumber: front.packNumber, slot: card.slot, auto: false },
            at(61),
          );
          if (!picked.ok) throw new Error(picked.error.kind);
          draft = picked.value.draft;
        }

        expect(draft.status).toBe("finished");
        const allCards = draft.packs.flatMap((pack) => pack.cards);
        expect(allCards.every((card) => card.pick !== null)).toBe(true);
        const pools = draft.seats.map((seat) => poolOf(draft, seat.seatNumber).length);
        expect(pools.reduce((a, b) => a + b, 0)).toBe(totalCards);
      }),
      { numRuns: 150 },
    );
  });
});

describe("bots (rule 16)", () => {
  const admin = { userId: alice, isAdmin: true };

  it("only an admin hosting the lobby can add them, while there's room", () => {
    const lobby = sampleLobby(["alice", "bob"], { maxSeats: 3 });
    expect(addBot(lobby, { userId: alice, isAdmin: false }, at(5))).toEqual({
      ok: false,
      error: { kind: "BotsForAdminsOnly" },
    });
    expect(addBot(lobby, { userId: bob, isAdmin: true }, at(5))).toEqual({
      ok: false,
      error: { kind: "NotHost" },
    });
    const withBot = unwrap(addBot(lobby, admin, at(5)));
    expect(withBot.seats.map((seat) => [seat.userId, seat.botNumber])).toEqual([
      ["alice", null],
      ["bob", null],
      ["alice", 1],
    ]);
    expect(addBot(withBot, admin, at(6))).toMatchObject({
      ok: false,
      error: { kind: "DraftFull" },
    });
  });

  it("belong to the admin, but don't count as the admin's own seat", () => {
    const lobby = unwrap(
      addBot(unwrap(addBot(sampleLobby(["alice"]), admin, at(1))), admin, at(2)),
    );
    expect(seatOf(lobby, alice)?.botNumber).toBeNull();
    expect(lobby.seats.map((seat) => seat.botNumber)).toEqual([null, 1, 2]);
  });

  it("can be removed for a refund, and the host closing the lobby refunds them with their own fee", () => {
    const lobby = unwrap(
      addBot(unwrap(addBot(sampleLobby(["alice", "bob"]), admin, at(1))), admin, at(2)),
    );
    const removed = unwrap(removeBot(lobby, alice, 1));
    expect(removed.refund).toEqual({ userId: alice, amount: 1647 });
    expect(removed.draft.seats.map((seat) => seat.botNumber)).toEqual([null, null, 2]);
    expect(removeBot(lobby, alice, 9)).toEqual({ ok: false, error: { kind: "BotNotFound" } });
    expect(removeBot(lobby, bob, 1)).toEqual({ ok: false, error: { kind: "NotHost" } });

    const closed = unwrap(leaveDraft(lobby, alice));
    expect(closed.refunds).toEqual([
      { userId: alice, amount: 3 * 1647 },
      { userId: bob, amount: 1647 },
    ]);
  });

  it("never get a deadline", () => {
    const lobby = unwrap(addBot(sampleLobby(["alice"]), admin, at(1)));
    const draft = startDraft(lobby, samplePacks(2, 3), at(60));
    expect(draft.seats.map((seat) => seat.deadline)).toEqual([at(150), null]);
  });
});

describe("dealt basics", () => {
  it("are kept on the started draft", () => {
    const basics = [
      { userId: alice, printingId: samplePrintingId("forest"), finish: "nonfoil" as const },
    ];
    const draft = startDraft(sampleLobby(["alice", "bob"]), samplePacks(2, 3), at(60), basics);
    expect(draft.basicsHandedOut).toEqual(basics);
  });
});
