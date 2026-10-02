# Design: live booster drafts

- **Phase:** 17
- **Status:** **Approved** (2026-10-01, with the decisions in section 14)
- **Related:** design doc 05 (pack engine), 03 (wallet), 09 and 14 (decks), 11 (activity), 12
  (reset), ADR 0005 (unit of work), ADR 0006 (reads), ADR 0008 (injected time and seeds),
  **ADR 0018** (live updates)

## 1. Purpose & scope

Requested 2026-10-01 (a friend's idea): players **draft live together**. Two to eight players sit
at a table, each opens a pack, picks one card and passes the rest to the next player, until every
card is gone, over three rounds (left, right, left). Then everyone plays the deck they drafted.

- Joining costs an **entry fee**: the packs' price (MSRP, ADR 0014). The server opens the packs, and
  **every card you draft is yours** (it goes into your game collection).
- The **host sets a pick timer, or turns it off**. When it runs out, the server picks for you.
  **Auto-picks fit your pool**: your colors, your curve, enough creatures.
- You can **reload or come back** at any time. A player who **loses the connection gets extra
  time** before the server picks for them.
- **When the draft ends, each player gets a deck** in their Decks list, marked as a draft deck. It
  starts as a suggested 40-card build (23 cards + 17 basics) with the rest of the pool in the
  sideboard.

**Out of scope (future-ideas):** bringing your own packs; other draft styles (cube, Rochester,
Winston, sealed); bots in empty seats; pairings, match results and prizes; a timer that shrinks as
the pack empties; kicking a player from a lobby; a pick-by-pick replay screen (the data is kept).

## 2. Ubiquitous language

| Term                | Meaning in this codebase                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Draft**           | One table: a booster, a host, seats, packs and picks. The aggregate.                                           |
| **Host**            | The player who created the draft. They start it, or cancel it while it's a lobby.                              |
| **Lobby**           | A draft that hasn't started: players join and leave.                                                           |
| **Seat**            | A player's place at the table. Seat 0 passes left to seat 1, and so on around.                                 |
| **Round**           | One pack per player, passed until empty. Rounds 1 and 3 pass left, round 2 right.                              |
| **Queue**           | The packs waiting in front of a seat. A fast picker can have nothing to do; a slow one, several packs waiting. |
| **Pick**            | Taking one card from the pack at the front of your queue. The rest of the pack passes on.                      |
| **Pool**            | Every card a player has picked in a draft.                                                                     |
| **Pick timer**      | Seconds per pick, or off. Set by the host.                                                                     |
| **Deadline**        | When the seat's current pick times out.                                                                        |
| **Away**            | A seat whose browser hasn't been in touch for 40 seconds.                                                      |
| **Grace**           | Extra time an away seat gets at its deadline (2 minutes at a time, at most 5 minutes per draft).               |
| **Auto-pick**       | The server's choice for a timed-out seat, or for an away seat when the host asks.                              |
| **Draft style**     | How packs move and who picks when. Only **booster** exists now; the style is a strategy (section 3).           |
| **Suggested build** | The 40-card deck made from the pool at the end: the best cards in your two colors plus basics.                 |

## 3. Domain model

```ts
// drafts/domain/draft.ts
type DraftId = Brand<number, "DraftId">;
type DraftStatus = "lobby" | "drafting" | "finished" | "cancelled";
type PickTimer = { kind: "off" } | { kind: "on"; secondsPerPick: number };

type Seat = {
  userId: UserId;
  seatNumber: number; // join order in the lobby; 0…n-1 around the table once started
  feePaid: Cents;
  joinedAt: Date;
  deadline: Date | null; // when the current pick times out (timer on, a pack waiting)
  deadlinePack: number | null; // which pack that deadline is for
  graceUsedSeconds: number;
  lastSeenAt: Date | null; // presence (section 7)
  packSource: { kind: "entryFee" }; // later: { kind: "ownPacks"; itemIds }
};

type DraftCard = {
  slot: number; // position in the pack, as opened
  printingId: PrintingId;
  finish: Finish;
  pick: { seat: number; pickNumber: number; auto: boolean; at: Date } | null;
};

type DraftPack = {
  packNumber: number; // unique within the draft
  round: number; // 1…packsPerPlayer
  openedBySeat: number;
  seed: string; // opens exactly the same pack again (ADR 0008)
  holderSeat: number; // whose queue it is in
  queuePosition: number; // arrival order: the lowest is the front of the queue
  cards: DraftCard[];
};

type Draft = {
  id: DraftId;
  hostId: UserId;
  setCode: SetCode;
  boosterType: string;
  style: DraftStyleName; // "booster"
  status: DraftStatus;
  maxSeats: number; // 2…8
  timer: PickTimer;
  entryFee: Cents; // per seat, fixed when the draft is created
  round: number; // 0 in the lobby
  sequence: number; // the next queue position to hand out
  seats: Seat[];
  packs: DraftPack[]; // empty until the draft starts
  version: number; // goes up with every change; browsers compare it (section 7)
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

// drafts/domain/style.ts: the Strategy pattern, as a table
type DraftStyle = Readonly<{
  packsPerPlayer: number;
  passDirection(round: number): "left" | "right";
}>;
const DRAFT_STYLES: Record<DraftStyleName, DraftStyle> = {
  booster: { packsPerPlayer: 3, passDirection: (round) => (round % 2 === 0 ? "right" : "left") },
};

// drafts/domain/auto-pick.ts
type DraftCardFacts = {
  name: string;
  rarity: Rarity;
  colors: Color[];
  manaCost: string | null;
  manaValue: number;
  typeLine: string;
  producedMana: Color[];
  marketPrice: Cents | null;
};
```

Every rule is a **pure function** over a `Draft`: `joinDraft`, `leaveDraft`, `cancelDraft`,
`startDraft(draft, packs, now)`, `applyPick`, `currentPack(draft, seat)`, `queueLength`,
`refreshDeadlines`, `runTimers(draft, now, chooseFor)`, `chooseAutoPick(pack, pool, facts)` and
`suggestBuild(pool, facts)`. The application layer loads the draft (locked), calls them, and saves
what they return.

## 4. Invariants

1. A player has **at most one seat in an unfinished draft** (lobby or drafting).
2. Every seat paid the draft's `entryFee`. Leaving a lobby, or the host cancelling it, refunds
   every seat's `feePaid`. Once the draft starts there are no refunds.
3. A draft starts with **2 to `maxSeats`** players. Only the host can start or cancel it.
4. At start, seats are renumbered 0…n-1 in join order, and each seat gets `packsPerPlayer` packs
   opened with fresh seeds. Only the current round's packs are ever visible.
5. **Every card is picked exactly once.** A seat may pick only from the **front of its own
   queue**. A pick names the pack and slot, so a double click or an old tab gets `StalePick`
   instead of picking the wrong card.
6. After a pick, a pack with cards left goes to the **back** of the next seat's queue (left in
   odd rounds, right in even ones). With two players, left and right are the same seat.
7. A round ends when all its packs are empty. The next round's packs then go to their openers'
   queues. After the last round the draft is **finished**.
8. Each pick puts the card into the picker's collection in the same transaction (source `draft`,
   ref `draft:<id>`), so an abandoned draft still leaves everyone with what they picked.
9. Timer on: a seat's deadline is `secondsPerPick` after a pack reaches the front of its queue. A
   seat with no pack has no deadline. Timer off: no deadlines and no automatic picks.
10. At its deadline, an **away** seat gets **2 minutes of grace**, as long as it has used less
    than **5 minutes** in this draft (the last extension is whatever is left). Otherwise, the
    server **auto-picks**. A seat that's present but not picking is auto-picked on time.
11. Auto-pick is deterministic: the same pack and pool always give the same card.
12. When the draft finishes, each player gets a `limited` deck holding their whole pool
    (suggested main deck + sideboard) unless they're at the 100-deck limit. Then the draft
    page offers "Make a deck" instead.
13. Only the seat itself sees its current pack. Other players see how many packs each seat has
    waiting, how many picks it has made, and whether it's away, but **never another seat's
    cards** until the draft is finished.
14. Every change bumps `version` and notifies browsers **only if the transaction commits**.

## 5. Use cases

| Use case        | Actor / authz            | Input                                                               | Output    | Errors (`kind`)                                                                                                   | Transaction?  |
| --------------- | ------------------------ | ------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- | ------------- |
| `createDraft`   | any player (joins)       | `setCode`, `boosterType`, `maxSeats`, `secondsPerPick` (null = off) | `DraftId` | `BoosterNotDraftable`, `PriceUnavailable`, `SeatsInvalid`, `TimerInvalid`, `AlreadyInADraft`, `InsufficientFunds` | yes           |
| `joinDraft`     | any player               | `draftId`                                                           | —         | `DraftNotFound`, `DraftNotOpen`, `DraftFull`, `AlreadyInADraft`, `InsufficientFunds`                              | yes           |
| `leaveDraft`    | a seat (host = cancel)   | `draftId`                                                           | —         | `DraftNotFound`, `NotSeated`, `DraftNotOpen`                                                                      | yes           |
| `startDraft`    | host                     | `draftId`                                                           | —         | `DraftNotFound`, `NotHost`, `DraftNotOpen`, `TooFewPlayers`, `BoosterUnavailable`                                 | yes           |
| `makePick`      | a seat                   | `draftId`, `packNumber`, `slot`                                     | —         | `DraftNotFound`, `NotSeated`, `DraftNotRunning`, `StalePick`                                                      | yes           |
| `pickForAway`   | host                     | `draftId`, `seatNumber`                                             | —         | `DraftNotFound`, `NotHost`, `DraftNotRunning`, `NotAway`, `NothingToPick`                                         | yes           |
| `markPresence`  | a seat                   | `draftId`, `here: boolean`                                          | —         | (silently nothing if not seated)                                                                                  | yes           |
| `makeDraftDeck` | a seat of a finished one | `draftId`                                                           | `DeckId`  | `DraftNotFound`, `NotSeated`, `DraftNotFinished`, `TooManyDecks`                                                  | yes           |
| `runTimers`     | the worker               | —                                                                   | counts    | —                                                                                                                 | one per draft |

In-transaction functions for other modules: `removeFromLobbies(services, userId)` (reset).

## 6. Ports

```ts
interface DraftRepository {
  create(draft: NewDraft): Promise<DraftId>;
  lock(draftId: DraftId): Promise<Draft | null>; // the whole aggregate, row locked FOR UPDATE
  save(before: Draft, after: Draft): Promise<void>; // writes what changed, bumps version
  activeDraftOf(userId: UserId): Promise<DraftId | null>; // invariant 1
  lobbiesWith(userId: UserId): Promise<DraftId[]>;
  withDeadlineBefore(now: Date): Promise<DraftId[]>; // the worker's work list
  setDeckOf(draftId: DraftId, userId: UserId, deckId: DeckId): Promise<void>;
}
interface DraftCatalog {
  isDraftable(setCode, boosterType): Promise<{ setName: string } | null>;
  packPrice(setCode, boosterType): Promise<Cents | null>; // MSRP of one pack (ADR 0014)
  cardFacts(printingIds): Promise<Map<PrintingId, DraftCardFacts>>;
  basicLands(setCode): Promise<Map<Color, PrintingId>>; // for the suggested build
}
interface DraftNotifier {
  changed(draftId: DraftId, version: number): Promise<void>; // pg_notify inside the transaction
}
// plus WalletServices (spend, receive), CollectionServices (receiveCards), PacksServices
// (openBooster), DecksServices (createDeckInTransaction), ActivityServices (recordEvent)
```

Outside the transaction: `DraftSubscriptions.subscribe(draftId, onVersion) → unsubscribe`, one
`LISTEN` connection in the app (ADR 0018).

## 7. State machines

| From     | Event                        | To        |
| -------- | ---------------------------- | --------- |
| (none)   | `createDraft`                | lobby     |
| lobby    | `joinDraft`, non-host leaves | lobby     |
| lobby    | host leaves / cancels        | cancelled |
| lobby    | host starts (≥ 2 seats)      | drafting  |
| drafting | pick (not the last)          | drafting  |
| drafting | last pick of the last round  | finished  |

**Presence:** the live connection (ADR 0018) marks the seat here when it opens and every 15
seconds after, and away when it closes. A seat is away when `lastSeenAt` is null or older than 40
seconds. Becoming here or away bumps the version, so the table shows it.

## 8. Persistence

- `drafts(id, host_id, set_code, booster_type, style, status, max_seats, seconds_per_pick null =
off, entry_fee_cents, round, sequence, version, created_at, started_at, finished_at)`. CHECKs on
  status, style, seats 2–8, timer 30–300.
- `draft_seats(draft_id, user_id, seat_number, fee_paid_cents, joined_at, deadline,
deadline_pack, grace_used_seconds, last_seen_at, deck_id)`. Primary key `(draft_id, user_id)`.
  Index on `deadline` for the worker.
- `draft_packs(draft_id, pack_number, round, opened_by_seat, seed, holder_seat, queue_position)`.
- `draft_cards(draft_id, pack_number, slot, printing_id, finish, picked_by_seat, pick_number,
picked_auto, picked_at)`. Primary key `(draft_id, pack_number, slot)`.
- **Other modules:** wallet ledger kinds `draft_entry` (out) and `draft_refund` (in); collection
  source `draft`; deck format `limited` and a nullable `decks.origin` text (`draft:12`). Each is
  a CHECK constraint change.

## 9. Read models (queries)

| Route          | Shows                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/drafts`      | your current draft, open lobbies (with the fee and seats), a form to host one, and your finished drafts                                                                                     |
| `/drafts/[id]` | **lobby**: seats, fee, timer, join/leave/start/cancel. **Drafting**: your pack, your picks by color and curve, the countdown, and the table. **Finished**: your pool and a link to the deck |

The header shows "Draft" with a dot while you're in an unfinished draft. The Decks list shows a
**Draft** badge and can be filtered to draft decks.

## 10. Events emitted

`draft` when a draft finishes: "Alice, Bob and Carol drafted Bloomburrow". Picks aren't posted:
too many, and they'd reveal what people took.

## 11. Patterns applied

- **Aggregate + pure functional core:** the whole draft (at most 8 × 3 × ~15 cards) is loaded,
  locked, changed by pure functions and saved. The repository writes only what changed.
- **Strategy as data:** `DRAFT_STYLES`, like `FORMAT_RULES` in decks.
- **State machine** as transition functions (section 7).
- **Unit of work** across drafts, wallet, collection, decks and activity. Lock order: **draft
  first**, then wallets (join, leave), then collection and decks (pick). Reset takes the draft
  locks first too.
- **Ports & adapters** for notifications: in tests a fake notifier records calls.
- **Injected clock and seeds:** deadlines and packs are reproducible in tests.

## 12. Test plan

- **Domain:** properties for 2–8 seats with random pack sizes: every card picked once, every seat's
  picks equal the cards it could reach, rounds alternate direction, picks only from the front of
  the queue. Deadlines, grace (extend until the budget runs out, then pick). Auto-pick: strongest
  card early, on-color later, creature and curve needs. Suggested build: 40 cards, 17 basics
  split by pips.
- **Use cases (fakes):** create/join pay the fee; insufficient funds changes nothing; leave and
  cancel refund; one draft per player; stale pick; timer off never auto-picks; the last pick makes
  a draft deck per player; host picks for an away seat.
- **Integration:** a full draft against Postgres; two picks at once are serialized; notifications
  arrive after commit and not after a rollback.
- **End-to-end:** two players draft a small table to the end in two browsers, updates arriving
  live, one reloading halfway; both find a Draft deck.

## 13. Open questions

None left (section 14).

## 14. Decisions made in review (2026-10-01)

1. **Entry fee only.** Bring-your-own packs later (the seat's `packSource` leaves room).
2. **Humans only**, 2–8 seats.
3. **Timer:** the host chooses 30–300 seconds or off. The default is **90 seconds**. Grace is **2
   minutes** at a time, **5 minutes** per draft. These are constants for now, not host settings.
4. **Auto-picks prefer your colors** and fill your curve, and they're used for the suggested
   build too.
5. **Every finished draft makes a deck**, with a Draft badge in the Decks list.
6. **Reload and rejoin** work at any time; nothing lives only in the browser.

## 15. Implementation notes (what changed while building)

- **Rule 1 is also a database rule.** `draft_seats.is_active` is true while the draft is a lobby
  or running, with a unique index on `user_id where is_active`. The use case checks first and
  gives a friendly `AlreadyInADraft`. The index stops two joins that race each other.
- **The repository saves a difference.** `save(before, after)` compares the two versions and
  writes only the changed seats, packs and picks. The pure functions never describe their own
  changes, so none can forget one.
- **Every change goes through `settle`:** new picks go into collections, a finished draft makes
  the decks and the feed event, and the notifier runs only when the version changed.
- **Heartbeats are quiet.** Presence updates `last_seen_at` every 15 seconds but bumps the
  version only when a seat becomes away or here. A pick also marks the picker as here.
- **Grace counts from now**, not from the old deadline, so a worker that was stopped for a while
  doesn't hand out grace that's already over.
- **One activity event, at the end.** `draft` ("Rin hosted a Bloomburrow draft for 4 players")
  when a draft finishes; no event at the start.
- **Deck size in the builder.** The stats panel aimed every non-Commander deck at 60 cards; it now
  asks `deckSize(format)` (40 for limited) next to `suggestedLands`.
- **Missing basics.** A catalog without a color's basic land (a partly synced one; the test
  fixtures only have Plains) gives those lands to the main color that has one, so the deck still
  has 40 cards.
- **Draftable boosters** are Play, Draft and older sets' only ("default") booster:
  `DRAFTABLE_BOOSTER_TYPES` in the domain. The host form shows each set's fee, priced in one query
  (`packMsrps` in the store, the same rule as `packMsrp`).
- **The worker runs the timers in their own loop**, beside the sync loop (a sync can take
  minutes). `pnpm worker draft-timers` runs them once.
- **Tests:** the timer and grace paths are tested with a fake clock (use cases) rather than end
  to end, because the shortest real timer is 30 seconds. The end-to-end test drafts a whole
  two-player table with the timer off, checks that updates arrive without reloads, and reloads
  one player halfway.
