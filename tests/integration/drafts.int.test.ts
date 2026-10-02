// Live drafts against real Postgres (design doc 17): a whole draft, picks at the same moment,
// and notifications that arrive only after a commit (ADR 0018).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SetCode } from "@/modules/catalog";
import { DraftId, makeDrafts, removeFromLobbies, type Draft } from "@/modules/drafts";
import { pgDraftSubscriptions } from "@/modules/drafts/infrastructure";
import { loadConfig } from "@/shared/config";
import { makeWallet } from "@/modules/wallet";
import { Cents, err } from "@/shared/kernel";
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
    // No basic land was drafted: they were dealt, one each give or take one (rule 15).
    const basicsInPacks = await db.execute<{ total: number }>(sql`
      select count(*)::int as total from draft_cards c join printings p on p.id = c.printing_id
       where c.draft_id = ${draftId} and p.type_line ~ '^Basic\\y.*\\yLand\\y'
    `);
    expect(basicsInPacks.rows[0].total).toBe(0);
    const dealt = await db.execute<{ user_id: string; total: number }>(sql`
      select user_id, count(*)::int as total from draft_basics
       where draft_id = ${draftId} group by user_id order by user_id
    `);
    const shares = dealt.rows.map((row) => row.total);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);

    // Every pick and every dealt basic reached a collection; free basics for the decks come on top.
    const received = await db.execute<{ total: number }>(sql`
      select coalesce(sum(quantity), 0)::int as total from acquisitions
       where source = 'draft' and ref = ${`draft:${draftId}`}
    `);
    const basicsDealt = await count("draft_basics", `draft_id = ${draftId}`);
    expect(received.rows[0].total).toBeGreaterThanOrEqual(cardsDealt + basicsDealt);
    expect(await count("draft_seats", `draft_id = ${draftId} and is_active`)).toBe(0);

    for (const player of ["alice", "bob"]) {
      const decks = await db.execute<{ format: string; origin: string; main: number }>(sql`
        select d.format, d.origin,
               (select sum(quantity) from deck_entries e where e.deck_id = d.id and e.board = 'main')::int as main
          from decks d join draft_seats s on s.deck_id = d.id
         where s.draft_id = ${draftId} and s.user_id = ${player}
      `);
      expect(decks.rows).toEqual([{ format: "limited", origin: `draft:${draftId}`, main: 40 }]);
      // The deck's basics are ones the player owns (rule 17), never more than 30 of a kind.
      const basics = await db.execute<{ name: string; needed: number; owned: number }>(sql`
        select p.name, sum(e.quantity)::int as needed,
               (select coalesce(sum(c.quantity), 0)::int from collection_cards c
                  join printings q on q.id = c.printing_id
                 where c.user_id = ${player} and q.name = p.name) as owned
          from deck_entries e
          join decks d on d.id = e.deck_id
          join draft_seats s on s.deck_id = d.id
          join printings p on p.id = e.printing_id
         where s.draft_id = ${draftId} and s.user_id = ${player} and e.board = 'main'
           and p.type_line ~ '^Basic\\y.*\\yLand\\y'
         group by p.name
      `);
      expect(basics.rows.length).toBeGreaterThan(0);
      for (const row of basics.rows) {
        expect(row.owned).toBeGreaterThanOrEqual(row.needed);
        expect(row.owned).toBeLessThanOrEqual(30);
      }
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

describe("bots (an admin's test)", () => {
  it("sit beside the admin in the database, pick at once, and give the admin their cards", async () => {
    const admin = actor("alice", true);
    await makeWallet({ unitOfWork, clock }).grantMoney(admin, {
      userId: admin.userId,
      amount: Cents.of(10_000),
      note: "testing drafts",
    });
    const created = await drafts.createDraft(admin, {
      setCode: SetCode.of("BLB"),
      boosterType: "play",
      maxSeats: 3,
      secondsPerPick: null,
    });
    if (!created.ok) throw new Error(created.error.kind);
    const draftId = created.value;
    expect((await drafts.addBot(admin, draftId)).ok).toBe(true);
    expect((await drafts.addBot(admin, draftId)).ok).toBe(true);
    expect(await count("draft_seats", `draft_id = ${draftId} and user_id = 'alice'`)).toBe(3);
    expect((await drafts.startDraft(admin, draftId)).ok).toBe(true);

    for (let turn = 0; turn < 100; turn += 1) {
      const choice = await frontCard(draftId, 0);
      if (choice === null) break;
      expect(await drafts.makePick(admin, choice)).toMatchObject({ ok: true });
    }
    expect((await load(draftId)).status).toBe("finished");
    const picked = await count("draft_cards", `draft_id = ${draftId}`);
    const received = await db.execute<{ total: number }>(sql`
      select coalesce(sum(quantity), 0)::int as total from acquisitions
       where user_id = 'alice' and ref = ${`draft:${draftId}`}
    `);
    expect(received.rows[0].total).toBeGreaterThanOrEqual(picked);
    expect(await count("draft_seats", `draft_id = ${draftId} and deck_id is not null`)).toBe(1);
    // The admin can host again: their bots don't hold them in a finished draft.
    expect(await count("draft_seats", `user_id = 'alice' and is_active`)).toBe(0);
  });
});

describe("Conspiracy state survives a round trip through Postgres (design doc 18)", () => {
  it("saves and loads notes, card states, watchers, turns, reveals, an added pack and deals", async () => {
    const draftId = await hostAndStart();
    const changed = await unitOfWork.run<Draft, never>(async (services) => {
      const before = await services.drafts.lock(draftId);
      if (before === null) throw new Error("no draft");
      const [first, second] = before.packs;
      const at = clock.now();
      const pick = (
        seat: number,
        pickNumber: number,
        state: "faceUp" | "returned" | "removedFaceDown",
      ) => ({
        seat,
        pickNumber,
        auto: false,
        at,
        round: 1,
        random: pickNumber === 2,
        state,
        poolSeat: seat,
        notes: [
          { kind: "count" as const, value: pickNumber },
          { kind: "colors" as const, choosers: [1, 0, 1], colors: ["W" as const] },
          { kind: "name" as const, name: "Bear", from: { packNumber: 0, slot: 0 } },
        ],
      });
      const after: Draft = {
        ...before,
        status: "dealing",
        packs: [
          {
            ...first,
            lastPassedBy: 1,
            watchers: [{ kind: "guess", seat: 0, card: { packNumber: 0, slot: 0 } }],
            cards: [
              { ...first.cards[0], pick: pick(0, 1, "faceUp") },
              { ...first.cards[1], pick: pick(0, 2, "returned") },
              ...first.cards.slice(2),
              {
                slot: first.cards.length,
                printingId: first.cards[1].printingId,
                finish: first.cards[1].finish,
                pick: null,
                cameFrom: { packNumber: first.packNumber, slot: 1 },
              },
            ],
          },
          {
            ...second,
            cards: [
              { ...second.cards[0], pick: pick(1, 1, "removedFaceDown") },
              ...second.cards.slice(1),
            ],
          },
          ...before.packs.slice(2),
          {
            ...first,
            packNumber: 99,
            addedBy: 0,
            queuePosition: -5,
            cards: first.cards.slice(0, 2).map((card) => ({ ...card, pick: null })),
          },
        ],
        seats: before.seats.map((seat, index) =>
          index === 0
            ? {
                ...seat,
                promptDeadline: at,
                deadlinePick: 3,
                abilities: {
                  skipPacks: 2,
                  lockedOutRound: 1,
                  turn: {
                    packNumber: 0,
                    extraCards: 1,
                    librarians: [{ packNumber: 0, slot: 1 }],
                    operatives: [],
                    agent: null,
                  },
                  armedSearchers: [{ packNumber: 0, slot: 0 }],
                  awaitingChoices: null,
                },
              }
            : seat,
        ),
        watches: [{ watcherSeat: 0, targetSeat: 1, card: { packNumber: 0, slot: 0 } }],
        reveals: [
          {
            at,
            audience: null,
            seat: 0,
            kind: "revealed",
            cards: [{ printingId: first.cards[0].printingId, finish: "nonfoil" }],
            about: { packNumber: 0, slot: 0 },
          },
          { at, audience: 1, seat: 0, kind: "spied", cards: [], about: null },
        ],
        deals: {
          current: {
            brokerSeat: 0,
            brokerCard: { packNumber: 0, slot: 0 },
            stage: "offers",
            revealed: { packNumber: 0, slot: 0 },
            offers: [{ seat: 1, card: null }],
            deadline: at,
          },
          waiting: [],
        },
      };
      await services.drafts.save(before, after);
      return { ok: true, value: after };
    });
    if (!changed.ok) throw new Error("unreachable");
    const loaded = await load(draftId);
    const comparable = (draft: Draft) => ({
      status: draft.status,
      packs: draft.packs,
      seats: draft.seats.map(({ lastSeenAt: _seen, ...rest }) => rest),
      watches: draft.watches,
      reveals: draft.reveals,
      deals: draft.deals,
    });
    expect(comparable(loaded)).toEqual(comparable(changed.value));
  });
});
