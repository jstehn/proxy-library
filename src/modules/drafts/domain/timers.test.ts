import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import { samplePacks, sampleLobby, START } from "../testing/samples";
import { addBot, applyPick, currentPack, poolOf, queueOf, startDraft, type Draft } from "./draft";
import {
  GRACE_BUDGET_SECONDS,
  GRACE_SECONDS,
  isAway,
  markPresence,
  pickForAway,
  runBots,
  runTimers,
  type ChooseCard,
} from "./timers";

const at = (seconds: number) => new Date(START.getTime() + seconds * 1000);
const alice = UserId.of("alice");
const bob = UserId.of("bob");
/** Always takes the last card left: easy to tell apart from a player's first-card picks. */
const lastCard: ChooseCard = (pack) =>
  Math.max(...pack.cards.filter((c) => c.pick === null).map((c) => c.slot));

function started(timer: Draft["timer"] = { kind: "on", secondsPerPick: 90 }): Draft {
  return startDraft(sampleLobby(["alice", "bob"], { timer }), samplePacks(2, 3, 3), at(0));
}

/** Both players are here at `seconds`. */
function bothHere(draft: Draft, seconds: number): Draft {
  return markPresence(markPresence(draft, alice, true, at(seconds)), bob, true, at(seconds));
}

describe("deadlines (rule 9)", () => {
  it("start when a pack reaches the front, and don't move while it stays there", () => {
    const draft = started();
    expect(draft.seats.map((seat) => seat.deadline)).toEqual([at(90), at(90)]);
    const pack = currentPack(draft, 0);
    if (pack === null) throw new Error("no pack");
    const picked = applyPick(
      draft,
      { seatNumber: 0, packNumber: pack.packNumber, slot: 0, auto: false },
      at(30),
    );
    if (!picked.ok) throw new Error(picked.error.kind);
    // Alice's pack went to the back of Bob's queue, so Alice waits with no deadline. Bob's own
    // pack is still in front of him, so his deadline stays where it was.
    expect(picked.value.draft.seats.map((seat) => seat.deadline)).toEqual([null, at(90)]);
  });

  it("don't exist with the timer off", () => {
    expect(started({ kind: "off" }).seats.map((seat) => seat.deadline)).toEqual([null, null]);
  });
});

describe("presence", () => {
  it("is away with no heartbeat for 40 seconds, and only a change of state bumps the version", () => {
    let draft = started();
    expect(isAway(draft.seats[0], at(1))).toBe(true); // never seen
    draft = markPresence(draft, alice, true, at(1));
    const version = draft.version;
    expect(isAway(draft.seats[0], at(41))).toBe(false);
    expect(isAway(draft.seats[0], at(42))).toBe(true);
    draft = markPresence(draft, alice, true, at(20)); // a heartbeat: still here
    expect(draft.version).toBe(version);
    draft = markPresence(draft, alice, false, at(25)); // the tab closed
    expect(draft.version).toBe(version + 1);
    expect(isAway(draft.seats[0], at(25))).toBe(true);
  });
});

describe("runTimers (rule 10)", () => {
  it("does nothing before a deadline", () => {
    const draft = started();
    expect(runTimers(draft, at(89), lastCard)).toEqual({ draft, autoPicks: [], extensions: 0 });
  });

  it("auto-picks for a player who is here but didn't pick", () => {
    const draft = bothHere(started(), 80);
    const outcome = runTimers(draft, at(90), lastCard);
    expect(outcome.extensions).toBe(0);
    expect(outcome.autoPicks.map((pick) => [pick.seatNumber, pick.card.slot])).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(poolOf(outcome.draft, 0)[0].pick?.auto).toBe(true);
  });

  it("gives an away player grace until the budget is used up, then picks", () => {
    let draft = markPresence(started(), bob, true, at(0)); // alice never connects
    let now = 90;
    const extensionsForAlice: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      draft = markPresence(draft, bob, true, at(now)); // bob stays
      const outcome = runTimers(draft, at(now), lastCard);
      draft = outcome.draft;
      const aliceSeat = draft.seats[0];
      extensionsForAlice.push(aliceSeat.graceUsedSeconds);
      if (aliceSeat.deadline === null) break;
      now = (aliceSeat.deadline.getTime() - START.getTime()) / 1000;
    }
    // 120 + 120 + 60 = 300 seconds of grace, then the timer picks for her.
    expect(extensionsForAlice).toEqual([
      GRACE_SECONDS,
      2 * GRACE_SECONDS,
      GRACE_BUDGET_SECONDS,
      GRACE_BUDGET_SECONDS,
    ]);
    expect(poolOf(draft, 0)).toHaveLength(1);
    expect(poolOf(draft, 0)[0].pick?.auto).toBe(true);
  });

  it("never picks with the timer off, but the host can pick for an away player", () => {
    const draft = started({ kind: "off" });
    expect(runTimers(draft, at(10_000), lastCard).autoPicks).toEqual([]);
    const here = markPresence(draft, bob, true, at(100));
    expect(pickForAway(here, 1, at(100), lastCard)).toEqual({
      ok: false,
      error: { kind: "NotAway" },
    });
    const picked = pickForAway(here, 1, at(200), lastCard); // bob's last heartbeat was 100 s ago
    expect(picked.ok && picked.value.card.slot).toBe(2);
  });
});

describe("runBots (rule 16)", () => {
  it("lets bots pick as soon as a pack reaches them, until a person has to pick", () => {
    let lobby = sampleLobby(["alice"]);
    for (let i = 0; i < 3; i += 1) {
      const added = addBot(lobby, { userId: alice, isAdmin: true }, at(i + 1));
      if (!added.ok) throw new Error(added.error.kind);
      lobby = added.value;
    }
    const started = startDraft(lobby, samplePacks(4, 3, 3), at(10));
    const { draft, picks } = runBots(started, at(10), lastCard);
    // Packs pass left: bot 1 picks from its pack; bot 2 from its own and bot 1's; bot 3 from all
    // three. Bot 1's pack is then empty, and the two others wait behind Alice's own pack.
    expect(picks).toBe(1 + 2 + 3);
    expect(queueOf(draft, 0).map((pack) => pack.openedBySeat)).toEqual([0, 3, 2]);
    // A bot is never away, however long since anyone heard from it.
    const bots = draft.seats.filter((seat) => seat.botNumber !== null);
    expect(bots.some((seat) => isAway(seat, at(9_999)))).toBe(false);
  });
});
