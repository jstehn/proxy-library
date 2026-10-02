# Lesson 17: Many players, one state

- **Phase:** 17 (live booster drafts)
- **Prerequisites:** [Lesson 05](05-randomness-you-can-trust.md) (seeds, strategy tables),
  [Lesson 06](06-transactions-across-modules.md) (one transaction across modules),
  [Lesson 10](10-two-players-one-transaction.md) (lock order), [Lesson 14](14-a-search-language-and-paper.md)
  (stale responses)
- **Time:** 2–3 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Model a shared, changing thing (a draft table) as an **aggregate**: load it whole, change it
   with pure functions, and save only the difference.
2. Keep **hidden information** hidden by deciding what each person sees in the query, not in the
   browser.
3. Store **deadlines** instead of running timers, and handle **presence** (who is here) with
   heartbeats.
4. Choose between **polling**, **Server-Sent Events** and **WebSockets**, and explain why Postgres
   `LISTEN`/`NOTIFY` fits a transaction.
5. Write a streaming route handler with a `ReadableStream`, and clean it up with an `AbortSignal`.
6. Subscribe to a stream from React with `EventSource`, `useEffect` cleanup and `useRef`.
7. Turn "what would a sensible player pick?" into a **scoring function**, and split a whole number
   fairly with the **largest remainder** method.

---

# Part A: One table, many players

## A1. What a draft is, in data

In a booster draft, every player opens a pack, takes one card, and passes the rest to the next
player. Then they take one card from the pack they were passed, and so on until the packs are
empty. Three packs each, passing left, then right, then left.

Before the code, the shape. A draft has **seats**, **packs**, and **cards in packs**. A card is
either still in a pack or **picked** by a seat. A pack is in front of some seat. That's all the
state there is.

```ts
// src/modules/drafts/domain/draft.ts (shortened)
type DraftCard = { slot: number; printingId: PrintingId; finish: Finish; pick: CardPick | null };
type DraftPack = {
  packNumber: number;
  round: number;
  holderSeat: number;
  queuePosition: number;
  cards: DraftCard[];
};
type Draft = {
  id: DraftId;
  status: DraftStatus;
  round: number;
  seats: Seat[];
  packs: DraftPack[];
  version: number; /* … */
};
```

**Python comparison:** three `@dataclass(frozen=True)` classes nested inside each other. A change
makes a new `Draft` with `dataclasses.replace(...)`, never edits the old one.

## A2. The aggregate: load whole, change pure, save the difference

An **aggregate** is a group of objects that change together and have rules across them ("every
card is picked exactly once" is a rule about all the packs at once). The rule of thumb: one
transaction changes one aggregate, and it **locks** the aggregate first, so two changes take turns.

A draft is small (at most 8 seats × 3 packs × about 15 cards = 360 cards), so the simplest design
works: load all of it, change it in memory, write back what changed.

```ts
// src/modules/drafts/application/drafts.ts
async function makePick(actor: Actor, input: PickInput): Promise<Result<void, PickError>> {
  return withDraft<void, PickError>(input.draftId, async (services, draft, now) => {
    const seat = seatOf(draft, actor.userId);
    if (seat === null) return err({ kind: "NotSeated" });
    const picked = applyPick(draft, { seatNumber: seat.seatNumber, /* … */ auto: false }, now);
    if (!picked.ok) return picked;
    const here = markSeatPresence(picked.value.draft, actor.userId, true, now);
    await settle(services, draft, here, now);
    return ok();
  });
}
```

Line by line:

- `withDraft` opens a transaction and runs `lock(draftId)`: `select … from drafts where id = $1
for update`, then the seats, packs and cards. A second pick on the same draft waits at that line
  until the first one commits.
- `applyPick` is **pure**: draft in, new draft out. All the rules live there, and the tests run
  them in milliseconds.
- `settle(services, before, after, now)` saves. The repository compares `before` and `after` and
  writes only what changed: one card's pick, one pack's holder, a few seats' deadlines.

Why compare instead of `UPDATE` everything? Correctness would be the same, but writing 360 cards
for every pick is a lot of work to change one row. And why not let `applyPick` return a list of
changes? Because then every pure function has to describe its own changes, and forgetting one
silently loses data. A diff in one place is harder to get wrong.

## A3. Queues, not turns

The first idea for passing is "everybody picks, then everybody passes". That makes the whole
table wait for its slowest player at every pick. Real drafts don't work that way: you pick and
pass straight away, and the packs pile up in front of whoever is slow.

So each seat has a **queue**: the packs it holds this round, ordered by `queuePosition`, a number
that only goes up (`draft.sequence`). A seat can pick only from the **front** of its queue.

```ts
export function queueOf(draft: Draft, seatNumber: number): DraftPack[] {
  if (draft.status !== "drafting") return [];
  return draft.packs
    .filter(
      (pack) => pack.round === draft.round && pack.holderSeat === seatNumber && cardsLeft(pack) > 0,
    )
    .sort((a, b) => a.queuePosition - b.queuePosition);
}
```

Why a counter and not the time the pack arrived? Two picks in the same millisecond would tie, and
in tests the clock doesn't move at all. A counter always increases, and it doesn't depend on the
clock.

**Python comparison:** `collections.deque` per seat, but stored as a "position" on each item so it
fits in a table.

## A4. Rules that hold for any table: a property test

"Every card is picked exactly once" must hold for 2 to 8 players, any pack sizes (some recipes
make 13 cards, some 15, an empty one can happen), and any order of picks. You can't write those
cases by hand. [Lesson 05](05-randomness-you-can-trust.md) introduced **property tests**:
fast-check makes random inputs and checks a rule on each.

```ts
// src/modules/drafts/domain/draft.test.ts (shortened)
fc.property(table, ({ seats, sizes, choices }) => {
  let draft = startDraft(sampleLobby(players), samplePacks(seats, 3, sizeOf), at(60));
  for (const choice of choices) {
    if (draft.status === "finished") break;
    const waiting = draft.seats.filter((seat) => currentPack(draft, seat.seatNumber) !== null);
    expect(waiting.length).toBeGreaterThan(0); // somebody can always pick: no deadlock
    // …pick a random card from a random waiting seat; check a pack further back is refused…
  }
  expect(draft.status).toBe("finished");
  expect(allCards.every((card) => card.pick !== null)).toBe(true);
});
```

The middle assertion is worth a second look: "while the draft runs, at least one seat has a
pack". If passing had a bug that sent a pack to nobody, or a round never ended, this is where it
would show.

**Try it:** `pnpm test src/modules/drafts`. Then break `passTarget` in `domain/style.ts` (return
`seat` instead of the neighbour) and watch the property test find a counterexample.

## A5. Hidden information belongs to the query

In a draft you must not see other players' packs. The browser can't be trusted with "hide this",
because anything sent to it can be read with the developer tools. So the decision is made where
the data is read:

```ts
// src/modules/drafts/queries/drafts.ts: draftView(db, draftId, userId, now)
// Everyone: each seat's name, how many packs wait for it, how many picks it made, away or here.
// Only the seat itself (`yourSeat`): the cards in its front pack, and its own picks.
```

The other seats come back as counts (`waiting`, `picks`), never cards. The page renders whatever
`draftView` returns, so no component can show what it was never given.

**Python comparison:** a Django view that filters the queryset by `request.user` instead of
sending everything and hiding it in the template.

---

# Part B: Time, without a clock in memory

## B1. Store deadlines, not timers

A pick timer could be a `setTimeout` in the server: "in 90 seconds, pick for Alice". But a
restart (a deploy, a crash) loses every timer, and with two server processes nobody knows which
one owns it. Instead, the timer is **data**: each seat has a `deadline` column. Anything can ask
"whose deadline has passed?" at any time:

```sql
select distinct s.draft_id from draft_seats s join drafts d on d.id = s.draft_id
 where d.status = 'drafting' and s.deadline <= $now;
```

The worker asks every 5 seconds (`worker/index.ts`, `draftTimerLoop`), and for each draft runs
`runTimers`, which is pure and takes `now` as an argument ([ADR 0008](../docs/adr/0008-injected-rng-clock.md)).
Tests move a `manualClock` forward 90 seconds instead of waiting.

The worker's sync loop can run for minutes, so the timer loop runs **beside** it:

```ts
await Promise.all([syncLoop(), draftTimerLoop()]);
```

**Python comparison:** `await asyncio.gather(sync_loop(), timer_loop())`. Both are `async`
functions that `await` a sleep, so neither blocks the other.

## B2. Presence: who is here?

The server can't see a browser close. It can only notice when the browser stops talking. So a
connected page sends a **heartbeat** (here: the stream in Part C does it every 15 seconds), the
server stores `lastSeenAt`, and a seat is **away** when that's older than 40 seconds, or null
(the page told us it closed).

```ts
export function isAway(seat: Pick<Seat, "lastSeenAt">, now: Date): boolean {
  if (seat.lastSeenAt === null) return true;
  return now.getTime() - seat.lastSeenAt.getTime() > AWAY_AFTER_SECONDS * 1000;
}
```

40 is more than two heartbeats, so one late heartbeat doesn't mark someone away.

`markPresence` bumps the draft's `version` **only when away/here changes**. Heartbeats write
`lastSeenAt`, but other players' pages don't reload every 15 seconds for nothing.

## B3. Grace: a budget, not a loop

A player whose internet drops shouldn't lose their pick at once. When an **away** seat's deadline
passes, it gets 2 more minutes, at most 5 minutes in the whole draft. Then the server picks for
it, so one missing player can't hold up the table forever:

```ts
function graceLeft(seat: Seat): number {
  return Math.min(GRACE_SECONDS, GRACE_BUDGET_SECONDS - seat.graceUsedSeconds);
}
```

`runTimers` deals with overdue seats **one at a time, earliest deadline first**, because each
auto-pick passes a pack and can give another seat a new deadline. It's a `for` loop with a guard,
the way you'd write `while True:` with a maximum in Python, so a bug can't spin forever.

## B4. A countdown in the browser: a stopwatch, not a clock

The page shows the time left for your pick. The obvious code, `deadline - new Date()`, uses the
**browser's** clock, which can be minutes wrong. The server sends its own time (`serverNow`) with
the page, and the browser only measures how much time has passed **since the page arrived**:

```ts
// src/app/drafts/[id]/countdown.tsx
const total = (new Date(props.deadline).getTime() - new Date(props.serverNow).getTime()) / 1000;
useEffect(() => {
  const shownAt = performance.now();
  const timer = setInterval(() => setElapsed((performance.now() - shownAt) / 1000), 250);
  return () => clearInterval(timer);
}, [props.deadline, props.serverNow]);
```

`performance.now()` is a **monotonic** stopwatch: it only goes forward and isn't affected by the
system clock being changed. **Python comparison:** `time.monotonic()` versus `time.time()`.

The countdown is only for show. The server decides when time is up.

---

# Part C: Pushing changes to the browser

## C1. Three ways to hear about a change

So far every page in the app showed what was true when it loaded. A draft needs other players'
picks to appear **without a reload**. The options:

| Way                    | How                                                | Good                                      | Bad                                            |
| ---------------------- | -------------------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| **Polling**            | the browser asks every few seconds                 | trivial, works everywhere                 | slow to feel live; a query per player per tick |
| **Server-Sent Events** | one long HTTP response the server keeps writing to | one direction, plain HTTP, auto-reconnect | server → browser only                          |
| **WebSockets**         | an upgraded, two-way connection                    | both directions                           | needs a custom server with Next.js             |

Picks already go to the server as server actions. The only thing missing is server → browser, so
**SSE** ([ADR 0018](../docs/adr/0018-live-updates.md)), with polling kept as a fallback.

## C2. Who tells the server something changed? `LISTEN`/`NOTIFY`

The change can happen in **another process**: the worker's auto-pick. The app needs to hear about
it. Postgres has a small built-in message system: a connection runs `LISTEN drafts`, and any
transaction can run `select pg_notify('drafts', '12:7')`.

The property that makes it fit: **a notification is delivered only when its transaction commits.**
If the pick rolls back, nobody hears about it. If it commits, everyone does. So the use case can
send the message in the middle of its work without worrying about the outcome.

**Try it:** in one terminal, listen and then wait:

```sh
psql -c "listen drafts" -c "select pg_sleep(10)" -c "select 'done'"
```

and within 10 seconds, in another:

```sh
psql -c "begin" -c "select pg_notify('drafts', '1:1')" -c "rollback"
psql -c "begin" -c "select pg_notify('drafts', '1:2')" -c "commit"
```

The first terminal prints only `Asynchronous notification "drafts" with payload "1:2"`. The
rolled-back `1:1` never arrives.

The app holds **one** listening connection for every draft (`pgDraftSubscriptions` in
`src/modules/drafts/infrastructure/pg-draft-events.ts`) and keeps a `Map` from draft id to the
callbacks that want it. If the connection drops, it reconnects and tells every subscriber
"refresh", because it may have missed something.

## C3. A streaming route handler

An SSE response is plain text in a simple format: lines of `field: value`, and a blank line ends
each message.

```
retry: 3000

event: version
data: 7

: still here

```

A line starting with `:` is a comment: browsers ignore it, but it keeps proxies from closing a
quiet connection.

The route handler returns a `Response` whose body is a `ReadableStream`, a stream the code
pushes bytes into whenever it likes:

```ts
// src/app/api/drafts/[id]/events/route.ts (shortened)
const stream = new ReadableStream<Uint8Array>({
  start(controller) {
    const sendVersion = (next: number | null) =>
      send(`event: version\ndata: ${next ?? "refresh"}\n\n`);
    const unsubscribe = getDraftSubscriptions().subscribe(draftId, sendVersion);
    const heartbeat = setInterval(() => {
      send(": still here\n\n");
      void markHere(true);
    }, 15_000);
    sendVersion(version); // the version right now: catches changes made while the page loaded
    stop = () => {
      clearInterval(heartbeat);
      unsubscribe();
      void markHere(false);
      controller.close();
    };
    request.signal.addEventListener("abort", stop);
  },
  cancel() {
    stop();
  },
});
return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
```

The part people forget is **cleanup**. When the browser goes, `request.signal` fires `abort`. If
nothing listens for it, the interval keeps running and the subscription keeps the callback alive
for every draft ever opened: a slow leak. `stop` undoes everything `start` set up, in one place,
and is safe to call twice.

**Python comparison:** Starlette's `StreamingResponse(async_generator())`, where the cleanup goes
in the generator's `finally:` block, which runs when the client disconnects.

Notice the stream never carries cards, only "version 7". The browser then reloads the page's
server data (`router.refresh()`), which runs `draftView` again. What a player may see is decided
in exactly one place (A5).

## C4. Subscribing from React

```tsx
// src/app/drafts/[id]/live-updates.tsx (shortened)
const shownVersion = useRef(props.version);
useEffect(() => {
  shownVersion.current = props.version;
}, [props.version]);

useEffect(() => {
  const source = new EventSource(`/api/drafts/${props.draftId}/events`);
  source.addEventListener("version", (event) => {
    const data = (event as MessageEvent<string>).data;
    if (data === "refresh" || Number(data) > shownVersion.current) router.refresh();
  });
  return () => source.close();
}, [props.draftId, router]);
```

Three React ideas in a few lines:

1. **`useEffect` with cleanup.** The function returned from an effect runs when the component goes
   away (the player leaves the page). Closing the `EventSource` there ends the stream, which fires
   the server's `abort` from C3. The two cleanups are two ends of the same wire.
2. **`useRef` for "the latest value".** The event handler is created once, when the effect runs.
   If it read `props.version` directly, it would see the version from that moment forever (a
   **stale closure**). A ref is a box whose `.current` the handler reads every time.
3. **Dependencies decide when the effect re-runs.** `[props.draftId, router]` doesn't include the
   version, on purpose: each refresh changes the version, and re-running the effect would close
   and reopen the stream every time.

`EventSource` reconnects by itself when a connection drops (after `retry:` milliseconds). The
component also counts errors, and after three it closes the stream and polls instead, for a
network that buffers streams.

---

# Part D: Choosing like a drafter

## D1. A scoring function

When the timer runs out, the server picks for you. "The most expensive card" would be easy and
wrong: a drafter who has taken eight green cards wants a green card, not a pricey blue one. The
pick is a **score** per card, highest wins:

```ts
// src/modules/drafts/domain/auto-pick.ts
export function pickScore(facts: DraftCardFacts, pool: readonly DraftCardFacts[]): number {
  if (isBasicLand(facts)) return 0;
  const settled = commitment(pool.length);
  const top = topColors(pool);
  return (
    cardStrength(facts) * colorFit(facts, top, settled) + needsBonus(facts, pool, top, settled)
  );
}
```

- `cardStrength`: rarity, nudged by price through `log10`, so $10 adds a little and $100 doesn't add
  ten times more.
- `commitment(picks)`: 0 for the first three picks, rising to 1 by pick 13. Early on, take the
  best card; later, stay in your lane.
- `colorFit`: a bonus for your top two colors, a penalty for a third, both multiplied by
  `commitment`. With only one main color so far, the second is still open.
- `needsBonus`: small nudges for creatures (a limited deck wants about 15) and against a crowded
  spot in the curve.

Each part is a small pure function with its own test, so "why did it pick that?" has an answer.
Ties go to the earliest slot, so the same pack and pool always give the same card.

**Python comparison:** `max(pack, key=lambda card: score(card, pool))`.

## D2. Splitting 17 lands fairly: the largest remainder

The deck made at the end needs 17 basic lands split by how many mana symbols of each color the
spells show. 14 green symbols to 9 blue gives 17 × 14/23 = 10.35 Forests and 6.65 Islands.
Rounding each one separately can give 10 + 7 = 17, or with three colors 6 + 6 + 6 = 18. Lands
must add up exactly.

The **largest remainder** method: give each color the whole part (10 and 6, total 16), then hand
the leftover lands one at a time to the colors with the biggest fractions (Islands, .65). It's
how some countries share parliament seats between parties.

```ts
for (const { color, share } of exact) counts.set(color, Math.floor(share));
let left = total - [...counts.values()].reduce((a, b) => a + b, 0);
for (const { color } of byRemainder) {
  if (left === 0) break;
  counts.set(color, (counts.get(color) ?? 0) + 1);
  left -= 1;
}
```

## D3. Room for other draft styles

Cube, Rochester and Winston drafts move packs differently. The domain doesn't hard-code "three
packs, left-right-left". It asks a **style**, kept in a table like the deck formats in
[lesson 09](09-rules-as-data.md):

```ts
export const DRAFT_STYLES: Readonly<Record<DraftStyleName, DraftStyle>> = { booster: boosterDraft };
```

Adding a style means adding a row and whatever new questions it needs answered. The draft stores
its style's name, so old drafts keep their rules.

---

## Common mistakes

- **A timer in memory.** `setTimeout` dies with the process. Store the deadline and check it from
  something that runs on a schedule.
- **Trusting the browser's clock.** It can be wrong. Send the server's time and measure elapsed
  time with a monotonic stopwatch.
- **Hiding data in the UI instead of not sending it.** Anything in the page can be read. Filter in
  the query.
- **Notifying before the commit.** Browsers then reload and see the old data, or hear about a
  change that rolls back. `NOTIFY` inside the transaction gets this right for free.
- **Forgetting cleanup on both ends of a stream.** Close the `EventSource` in the effect's
  cleanup; on the server, undo everything on `abort`.
- **Reading props inside a long-lived callback.** It sees the value from when it was made. Use a
  ref for "the latest".
- **Turns instead of queues.** Making everyone wait for the slowest player at every pick is a
  design bug, not a performance one.
- **Rounding parts separately when they must add up.** Use the largest remainder.

## Exercises

### 1. Passing right (warm-up)

With 4 seats, where does each seat pass in a "right" round? Why does `passTarget` add `seatCount`
before taking `%`?

<details><summary>Solution</summary>

Seats 0, 1, 2, 3 pass to 3, 0, 1, 2. In JavaScript, `%` keeps the sign of the left side:
`-1 % 4` is `-1`, not `3` as in Python. Adding `seatCount` first makes the left side positive:
`(-1 + 4) % 4` is `3`.

```ts
expect(-1 % 4).toBe(-1);
expect([0, 1, 2, 3].map((seat) => passTarget(seat, "right", 4))).toEqual([3, 0, 1, 2]);
```

</details>

### 2. How much grace?

Write `extensions(grace: number, budget: number): number[]`, the lengths of the extensions an
away player gets, in order, before the timer picks for them. `extensions(120, 300)` is
`[120, 120, 60]`.

_Hint:_ `graceLeft` in `domain/timers.ts` is one step of it.

<details><summary>Solution</summary>

```ts
function extensions(grace: number, budget: number): number[] {
  const given: number[] = [];
  let used = 0;
  while (used < budget) {
    const next = Math.min(grace, budget - used);
    given.push(next);
    used += next;
  }
  return given;
}
// extensions(120, 300) → [120, 120, 60]; extensions(120, 0) → []; extensions(100, 300) → [100, 100, 100]
```

</details>

### 3. Lands by hand

The main deck shows 5 white, 5 blue and 2 green mana symbols. Split 17 basic lands with the largest
remainder method, by hand, then check with `splitLands`.

<details><summary>Solution</summary>

Shares: 17 × 5/12 = 7.08 Plains, 7.08 Islands, 17 × 2/12 = 2.83 Forests. Whole parts: 7 + 7 + 2 =
16, so 1 land is left. The biggest fraction is green's .83, so it goes there: **7 Plains, 7
Islands, 3 Forests**.

```ts
const split = splitLands(
  17,
  new Map([
    ["W", 5],
    ["U", 5],
    ["G", 2],
  ]),
);
expect(Object.fromEntries(split)).toEqual({ W: 7, U: 7, G: 3 });
```

</details>

### 4. An SSE message with several lines

In SSE, a `data:` value can't contain a newline: each line of the data gets its own `data:` line,
and the browser joins them back with `\n`. Write `sseEvent(event: string, data: string): string`.

<details><summary>Solution</summary>

```ts
function sseEvent(event: string, data: string): string {
  const dataLines = data.split("\n").map((line) => `data: ${line}`);
  return [`event: ${event}`, ...dataLines].join("\n") + "\n\n";
}
// sseEvent("version", "7") → "event: version\ndata: 7\n\n"
// sseEvent("note", "a\nb") → "event: note\ndata: a\ndata: b\n\n"
```

</details>

### 5. A new style (challenge)

Write a `DraftStyle` for a four-pack draft that always passes left. What else in the module would
you check before adding it to `DRAFT_STYLES`?

<details><summary>Solution</summary>

```ts
const fourPacksAllLeft: DraftStyle = {
  packsPerPlayer: 4,
  passDirection: () => "left",
};
```

Then: the `drafts_style_known` CHECK constraint in `infrastructure/schema.ts` (a migration), the
entry fee (`packsPerPlayer` packs, not three: `createDraft` uses `DRAFT_STYLES.booster` today), the
pick screen's "Round 1 of 3", and the suggested build (with four packs a pool has about 56 cards,
which is fine). The property test in A4 works for any style once it reads `packsPerPlayer`.

</details>

### 6. Why inside the transaction? (discussion)

The notifier runs `pg_notify` in the middle of the pick's transaction. What could go wrong if the
use case sent the message **after** committing, from application code, instead?

<details><summary>Solution</summary>

Two things. If the process stopped between the commit and the message (a crash, a deploy),
browsers would never hear about a change that happened: they'd sit on an old pack until someone
reloads. And the code would have to remember to send it after every successful path but never
after a failed one, in every use case. Inside the transaction, Postgres does both for us: the
message goes out exactly when the change becomes visible, and never for a rollback.

</details>

## Recap

- A shared, changing thing is an **aggregate**: lock it, change it with **pure functions**, save
  the **difference**.
- **Queues** let fast players keep going; a **counter** orders them without trusting the clock.
- **Property tests** check rules like "every card picked once" across every table size.
- **Hidden information** is filtered in the query; the browser only gets what it may show.
- Timers are **deadlines in the database**, checked by a loop that takes `now` as an input.
- **Presence** is heartbeats and a cut-off; **grace** is a budget.
- **SSE** pushes "something changed"; **`NOTIFY` in the transaction** fires only on commit; the
  page re-reads its own data.
- Streams need **cleanup at both ends**: `useEffect`'s return and the request's `abort`.
- A sensible automatic choice is a **scoring function** built from small, testable parts.
- Parts that must add up are rounded with the **largest remainder** method.

## Further reading

- [Design doc 17](../docs/design/17-drafts.md) and [ADR 0018](../docs/adr/0018-live-updates.md).
- MDN: [Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
  and [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream).
- PostgreSQL: [`NOTIFY`](https://www.postgresql.org/docs/current/sql-notify.html) (see "NOTIFY
  interacts with SQL transactions").
- Next.js: "Streaming in Route Handlers" in `node_modules/next/dist/docs/01-app/02-guides/streaming.md`.
- React: [`useEffect` cleanup](https://react.dev/reference/react/useEffect#connecting-to-an-external-system).
- Wikipedia: [Largest remainder method](https://en.wikipedia.org/wiki/Largest_remainder_method).
