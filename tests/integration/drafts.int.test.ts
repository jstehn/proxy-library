// Live drafts against real Postgres (design doc 17): a whole draft, picks at the same moment,
// and notifications that arrive only after a commit (ADR 0018).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SetCode } from "@/modules/catalog";
import { DraftId, makeDrafts, removeFromLobbies, type Draft } from "@/modules/drafts";
import { pgDraftSubscriptions } from "@/modules/drafts/infrastructure";
import { loadConfig } from "@/shared/config";
import { err } from "@/shared/kernel";
import { randomSeed } from "@/shared/runtime";
import {
  actor,
  balance,
  clock,
  close,
  count,
  db,
  loadFixtureCatalog,
  resetPlayers,
  unitOfWork,
} from "./harness";

const subscriptions = pgDraftSubscriptions(loadConfig().databaseUrl);
afterAll(async () => {
  await subscriptions.close();
  await close();
});

const drafts = makeDrafts({ unitOfWork, clock, seeds: { newSeed: randomSeed } });
const alice = actor("alice");
const bob = actor("bob");

beforeAll(async () => {
  await loadFixtureCatalog();
});

beforeEach(async () => {
  await resetPlayers(["alice", "bob"]);
});

async function hostAndStart(): Promise<DraftId> {
  const created = await drafts.createDraft(alice, {
    setCode: SetCode.of("BLB"),
    boosterType: "play",
    maxSeats: 2,
    secondsPerPick: 90,
  });
  if (!created.ok) throw new Error(created.error.kind);
  expect((await drafts.joinDraft(bob, created.value)).ok).toBe(true);
  expect((await drafts.startDraft(alice, created.value)).ok).toBe(true);
  return created.value;
}

async function load(draftId: DraftId): Promise<Draft> {
  const loaded = await unitOfWork.run<Draft, never>(async (services) => {
    const draft = await services.drafts.lock(draftId);
    if (draft === null) throw new Error("no such draft");
    return { ok: true, value: draft };
  });
  if (!loaded.ok) throw new Error("unreachable");
  return loaded.value;
}

/** The front pack and first card left for a seat, read from the database. */
async function frontCard(draftId: DraftId, seatNumber: number) {
  const rows = await db.execute<{ pack_number: number; slot: number }>(sql`
    select p.pack_number, c.slot
      from draft_packs p
      join drafts d on d.id = p.draft_id and d.round = p.round
      join draft_cards c on c.draft_id = p.draft_id and c.pack_number = p.pack_number
     where p.draft_id = ${draftId} and p.holder_seat = ${seatNumber} and c.picked_by_seat is null
     order by p.queue_position, c.slot
     limit 1
  `);
  const row = rows.rows[0];
  return row === undefined ? null : { draftId, packNumber: row.pack_number, slot: row.slot };
}

describe("a whole draft", () => {
  it("charges fees, deals packs, moves every pick into a collection, and makes decks", async () => {
    const draftId = await hostAndStart();
    const fee = (await load(draftId)).entryFee;
    expect(fee).toBeGreaterThan(0);
    expect(await balance("alice")).toBe(5000 - fee);

    for (let turn = 0; turn < 100; turn += 1) {
      const draft = await load(draftId);
      if (draft.status !== "drafting") break;
      for (const [player, seatNumber] of [
        [alice, 0],
        [bob, 1],
      ] as const) {
        const choice = await frontCard(draftId, seatNumber);
        if (choice !== null)
          expect(await drafts.makePick(player, choice)).toMatchObject({ ok: true });
      }
    }

    const draft = await load(draftId);
    expect(draft.status).toBe("finished");
    const cardsDealt = await count("draft_cards", `draft_id = ${draftId}`);
    expect(await count("draft_cards", `draft_id = ${draftId} and picked_by_seat is null`)).toBe(0);
    expect(await count("acquisitions", `source = 'draft' and ref = 'draft:${draftId}'`)).toBe(
      cardsDealt,
    );
    expect(await count("draft_seats", `draft_id = ${draftId} and is_active`)).toBe(0);

    for (const player of ["alice", "bob"]) {
      const decks = await db.execute<{ format: string; origin: string; main: number }>(sql`
        select d.format, d.origin,
               (select sum(quantity) from deck_entries e where e.deck_id = d.id and e.board = 'main')::int as main
          from decks d join draft_seats s on s.deck_id = d.id
         where s.draft_id = ${draftId} and s.user_id = ${player}
      `);
      expect(decks.rows).toEqual([{ format: "limited", origin: `draft:${draftId}`, main: 40 }]);
    }
    expect(await count("activity_events", "kind = 'draft'")).toBeGreaterThan(0);
  });
});

describe("two picks at the same moment", () => {
  it("are serialized: a double click picks once, and the copy is told it's stale", async () => {
    const draftId = await hostAndStart();
    const choice = await frontCard(draftId, 0);
    if (choice === null) throw new Error("nothing to pick");
    const [first, second] = await Promise.all([
      drafts.makePick(alice, choice),
      drafts.makePick(alice, choice),
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].find((result) => !result.ok)).toEqual({
      ok: false,
      error: { kind: "StalePick" },
    });
    expect(await count("draft_cards", `draft_id = ${draftId} and picked_by_seat = 0`)).toBe(1);
  });

  it("from different seats both go through", async () => {
    const draftId = await hostAndStart();
    const [aliceChoice, bobChoice] = [await frontCard(draftId, 0), await frontCard(draftId, 1)];
    if (aliceChoice === null || bobChoice === null) throw new Error("nothing to pick");
    const results = await Promise.all([
      drafts.makePick(alice, aliceChoice),
      drafts.makePick(bob, bobChoice),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
  });
});

describe("notifications (ADR 0018)", () => {
  /** Waits until `predicate` holds, checking every 20 ms, for at most two seconds. */
  async function eventually(predicate: () => boolean) {
    for (let waited = 0; waited < 2000 && !predicate(); waited += 20) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return predicate();
  }

  it("arrive after a commit, and never for a rolled-back change", async () => {
    const draftId = await hostAndStart();
    const heard: Array<number | null> = [];
    const unsubscribe = subscriptions.subscribe(draftId, (version) => heard.push(version));
    // Give the listener time to connect and LISTEN.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // A notification sent inside a transaction that then rolls back.
    const rolledBack = await unitOfWork.run(async (services) => {
      await services.draftNotifier.changed(draftId, 999);
      return err({ kind: "RolledBack" });
    });
    expect(rolledBack.ok).toBe(false);

    const before = (await load(draftId)).version;
    const choice = await frontCard(draftId, 0);
    if (choice === null) throw new Error("nothing to pick");
    await drafts.makePick(alice, choice);

    // The pick (and the player showing up) raised the version; the last one is announced.
    expect(
      await eventually(() => heard.some((version) => version !== null && version > before)),
    ).toBe(true);
    unsubscribe();
    expect(heard).not.toContain(999);
  });
});

describe("one unfinished draft per player", () => {
  it("is also enforced by the database, should two joins race", async () => {
    const draftId = await hostAndStart();
    // A second lobby, made with SQL so the use case's own check can't stop it.
    const other = await db.execute<{ id: number }>(sql`
      insert into drafts (host_id, set_code, booster_type, style, status, max_seats,
                          entry_fee_cents, round, sequence, version, created_at)
      values ('bob', 'BLB', 'play', 'booster', 'lobby', 2, 0, 0, 0, 1, now())
      returning id
    `);
    await expect(
      db.execute(sql`
        insert into draft_seats (draft_id, user_id, seat_number, fee_paid_cents, joined_at,
                                 pack_source, grace_used_seconds, is_active)
        values (${other.rows[0].id}, 'alice', 1, 0, now(), 'entryFee', 0, true)
      `),
    ).rejects.toThrow();
    const second = await drafts.createDraft(alice, {
      setCode: SetCode.of("BLB"),
      boosterType: "play",
      maxSeats: 2,
      secondsPerPick: null,
    });
    expect(second).toEqual({ ok: false, error: { kind: "AlreadyInADraft", draftId } });
  });

  it("is left when a reset takes the player out of a lobby, with the fee refunded", async () => {
    const created = await drafts.createDraft(alice, {
      setCode: SetCode.of("BLB"),
      boosterType: "play",
      maxSeats: 4,
      secondsPerPick: null,
    });
    if (!created.ok) throw new Error(created.error.kind);
    await drafts.joinDraft(bob, created.value);
    const left = await unitOfWork.run<number, never>(async (services) => ({
      ok: true,
      value: await removeFromLobbies(services, bob.userId, clock.now()),
    }));
    expect(left).toEqual({ ok: true, value: 1 });
    expect(await balance("bob")).toBe(5000);
    expect(await count("draft_seats", `user_id = 'bob'`)).toBe(0);
  });
});
