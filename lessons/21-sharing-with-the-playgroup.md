# Lesson 21: Sharing with the playgroup

- **Phase:** 21 (sharing decks, comments, and cards to get)
- **Prerequisites:** [Lesson 02](02-accounts-and-forms.md) (actors, server actions and forms),
  [Lesson 09](09-rules-as-data.md) (ownership shared between decks),
  [Lesson 11](11-shipping-it.md) (events in the same transaction),
  [Lesson 12](12-undoing-a-whole-account.md) (reset)
- **Time:** 1.5 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Write **authorization as pure policy functions** and test every role without a database.
2. Answer **"not found"** instead of **"forbidden"** when the thing's existence is private.
3. Keep a feed honest: record an event **once**, in the **same transaction**, and forget it when
   what it points to is gone.
4. Use a **soft delete** and a **check constraint** that knows about it.
5. Aggregate with **max, not sum**, when one thing serves many owners, in TypeScript and in SQL.
6. Hand a list to another screen without **subtracting the same thing twice**.

---

# Part A: Who may see and do what

## A1. Policies are pure functions

Sharing adds three questions: may this player **see** this deck, **comment** on it, **delete**
this comment? Each one is a function of facts, with no database involved:

```ts
// src/modules/decks/domain/sharing.ts
export function canViewDeck(
  viewer: UserId,
  deck: Pick<DeckForSharing, "ownerId" | "visibility">,
): boolean {
  return deck.ownerId === viewer || deck.visibility === "shared";
}

export function canDeleteComment(
  actor: Readonly<{ userId: UserId; isAdmin: boolean }>,
  comment: Pick<DeckComment, "authorId">,
  deck: Pick<DeckForSharing, "ownerId">,
): boolean {
  return actor.isAdmin || actor.userId === comment.authorId || actor.userId === deck.ownerId;
}
```

Because they're pure, the tests are a table of roles: author yes, deck owner yes, admin yes,
anyone else no. Every caller then uses the **same** rule: the use case before deleting, the page
before drawing a Delete button, the query before showing a deck. If the rule changes, it changes
in one place.

The parameters ask for as little as they need (`Pick<…>`, lesson 19), so a test builds
`{ ownerId: jack }` rather than a whole deck.

**Python comparison:** small functions in a `policies.py`, used by both views and services,
instead of `if request.user == …` scattered through the views.

## A2. Not found, not forbidden

If Sam asks for Jack's **private** deck, the answer is 404 "not found", not 403 "forbidden".
"Forbidden" would confirm that deck 12 exists and belongs to someone. The use cases do the same:

```ts
const deck = await services.deckSharing.lockDeck(input.deckId);
if (deck === null || !canViewDeck(actor.userId, deck)) return err({ kind: "DeckNotFound" });
```

When the thing is known to the player, "you may not" is the right answer: Sam can see a
comment, so deleting it gives `NotAllowed`. Choose by asking whether the answer itself leaks
something.

## A3. A second factory, so the first doesn't change

Sharing needs the activity recorder in its transaction; the existing deck use cases don't.
Rather than add services to `makeDecks` (and to every fake its tests build), the new use cases
got their own factory with their own services type:

```ts
export type DeckSharingServices = { deckSharing: DeckSharingRepository } & ActivityServices;
export function makeDeckSharing(dependencies: DeckSharingDependencies) { … }
```

The same transaction can still hold both: the composition root (`src/server/core.ts`) builds one
object with every repository, and each factory reads the part its type names. **Split by what
changes together**, not by which table it touches.

---

# Part B: A feed that tells the truth

## B1. Once, not every time

Sharing a deck posts "Jack shared a deck: Beza" to the activity feed. If Jack switches it off and
on five times, the feed shouldn't say it five times. The deck remembers **when it was first
shared**:

```ts
const firstShare = input.visibility === "shared" && deck.firstSharedAt === null;
await services.deckSharing.setVisibility(deck.id, input.visibility, firstShare ? now : deck.firstSharedAt);
if (firstShare) await recordEvent(services, { kind: "deckShared", … }, now);
```

The event is recorded **inside the same transaction** as the change (lesson 11), so a rolled-back
share never appears in the feed. The deck row is **locked** first (`select … for update`), so two
quick clicks can't both see `firstSharedAt === null`.

## B2. Forgetting what points nowhere

A reset deletes a player's decks. A feed item "Jack shared a deck: Beza" would then link to
nothing. So the reset's "forget" step, which already removed pulls and purchases, now also
removes `deckShared`. It was renamed to say what it does:

```ts
/** Events about a player's own library, which a reset forgets (design docs 12 and 21). */
export const LIBRARY_EVENT_KINDS = ["pull", "purchase", "deckShared"] as const;
```

Comments the player wrote on **other** players' decks stay, like trades: they're part of
someone else's conversation. While renaming, the in-memory fake turned out to forget more than the
real recorder (it dropped draft events too). Both now read the one constant, so they can't drift
apart again. **When a fake and the real thing each hard-code a rule, one of them is probably
wrong.**

---

# Part C: Deleting softly

A comment can be deleted, but the thread should keep its shape: "Rin: _Comment removed._"
explains the reply that follows it. That's a **soft delete**: mark the row deleted and drop its
text, rather than removing the row.

The table's check constraint wanted 1–1 000 characters. The first version stored a single space
in deleted comments to get past it, which is a hack someone would trip over later. The fix was to
make the constraint say the real rule:

```ts
check(
  "deck_comments_body_length",
  sql`(${table.deletedAt} is not null and ${table.body} = '') or char_length(${table.body}) between 1 and 1000`,
),
```

Now the database knows the two valid states: a live comment with text, or a deleted one with
none. The query turns `deleted_at` into `body: null`, and the page shows "Comment removed."
**Python comparison:** a `CheckConstraint(Q(deleted_at__isnull=False, body="") | Q(...))` on a
Django model.

---

# Part D: Max, not sum

## D1. One copy serves every deck

Decks share your collection (design doc 09): one Lightning Bolt can sit in three decks. So "what
do I still need?" isn't the sum of every deck's shortfall. It's what the **hungriest** deck needs,
minus what you own:

| Deck  | Uses | You own | Sum says  | Max says  |
| ----- | ---- | ------- | --------- | --------- |
| Burn  | 4    |         |           |           |
| Jund  | 2    |         |           |           |
| Total |      | 1       | 6 − 1 = 5 | 4 − 1 = 3 |

Buying 3 gives you 4, enough for Burn and for Jund at the same time. Buying 5 wastes 2.

```ts
// src/modules/decks/domain/sharing.ts (the heart of it)
const have = owned.get(oracleId) ?? 0;
const most = Math.max(...decks.values());
if (most <= have) continue;
result.push({ oracleId, missing: most - have, deckIds: short });
```

**In SQL** it's the same shape, `max()` over a `group by`:

```sql
select n.oracle_id, max(n.quantity) - coalesce(o.quantity, 0) as missing
  from needs n left join owned o on o.oracle_id = n.oracle_id
 group by n.oracle_id, o.quantity
having max(n.quantity) > coalesce(o.quantity, 0)
```

**Python comparison:** `df.groupby("oracle_id").quantity.max() - owned`.

## D2. Don't subtract twice

"Buy them all" hands the list to Buy a list, which has an option "only buy what I don't already
own", on by default. If the list already said "3 Lightning Bolt" (the shortfall), Buy a list would
subtract your 1 copy **again** and buy 2.

That's exactly the bug this phase found in the older **"Buy what it's short"** link (design doc
15): it wrote the shortfall, and the quote subtracted ownership a second time. The fix: hand over
the **deck's own count** ("4 Lightning Bolt") and let the screen that owns the rule (Buy a list)
apply it once. An integration test now runs the whole path: a deck needing 4, owning 1, its list,
and a quote that buys exactly 3.

The lesson is general: **when two steps each apply the same adjustment, decide which one owns
it.** Here the buying screen does, because a person can switch the option off there.

---

## Common mistakes

- **Checking permissions in the page only.** The use case must check too: a form can be posted
  without the page.
- **403 for private things.** It tells the asker the thing exists.
- **Announcing every toggle.** Remember the first time (and lock while you check).
- **A fake with its own copy of a rule.** Share the constant, or the fake tests a different
  program.
- **Hacking around a constraint** instead of making it state the real rule.
- **Summing shared resources.** One copy serves many decks: use the maximum.
- **Applying an adjustment in two places.** Pick the owner of the rule.

## Exercises

### 1. Warm-up: strict ownership

future-ideas.md lists "strict ownership": a copy used by one deck can't be used by another. Write
`strictCopiesToGet(needs, owned)` for that world, and compare it with `cardsToGet` for Burn (4)
and Jund (2) owning 1.

<details><summary>Solution</summary>

```ts
function strictCopiesToGet(
  needs: readonly DeckNeed[],
  owned: ReadonlyMap<string, number>,
): Map<string, number> {
  const total = new Map<string, number>();
  for (const need of needs)
    total.set(need.oracleId, (total.get(need.oracleId) ?? 0) + need.quantity);
  const result = new Map<string, number>();
  for (const [oracleId, quantity] of total) {
    const missing = quantity - (owned.get(oracleId) ?? 0);
    if (missing > 0) result.set(oracleId, missing);
  }
  return result;
}
// strict: 6 − 1 = 5; shared (cardsToGet): 4 − 1 = 3
```

The rule about ownership decides whether "how many do I need" is a sum or a maximum.

</details>

### 2. A policy with time in it

Write `canEditComment(actor, comment, now)`: only the author, only while the comment isn't
deleted, and only within 10 minutes of posting. Why does `now` come in as a parameter?

<details><summary>Solution</summary>

```ts
const EDIT_WINDOW_MILLISECONDS = 10 * 60 * 1000;
function canEditComment(
  actor: Readonly<{ userId: UserId }>,
  comment: Readonly<{ authorId: UserId; createdAt: Date; deletedAt: Date | null }>,
  now: Date,
): boolean {
  return (
    actor.userId === comment.authorId &&
    comment.deletedAt === null &&
    now.getTime() - comment.createdAt.getTime() <= EDIT_WINDOW_MILLISECONDS
  );
}
```

`now` is a parameter so the policy stays pure and testable at "exactly 10 minutes" and "10
minutes and 1 second". The use case passes `clock.now()` (lesson 03).

</details>

### 3. Max in SQL

Given `needs(deck_id, oracle_id, quantity)` and `owned(oracle_id, quantity)`, write a query
returning each card's missing copies under shared ownership. Try it in `psql` with `values`.

<details><summary>Solution</summary>

```sql
with needs(deck_id, oracle_id, quantity) as (values (1, 'bolt', 4), (2, 'bolt', 2), (2, 'ring', 1)),
     owned(oracle_id, quantity) as (values ('bolt', 1))
select n.oracle_id, max(n.quantity) - coalesce(o.quantity, 0) as missing
  from needs n left join owned o on o.oracle_id = n.oracle_id
 group by n.oracle_id, o.quantity
having max(n.quantity) > coalesce(o.quantity, 0);
-- bolt | 3
-- ring | 1
```

`having` filters groups after aggregating (`where` filters rows before).

</details>

### 4. Challenge: which answer leaks?

For each request, say whether the reply should be "not found" or "not allowed", and why: (a) Sam
opens Jack's private deck; (b) Sam deletes Jack's comment on Jack's shared deck; (c) Sam comments
on a shared deck that Jack has just made private.

<details><summary>Solution</summary>

(a) Not found: Sam has no way to know the deck exists. (b) Not allowed: Sam can see the comment,
so its existence isn't a secret; the honest answer is that Sam may not delete it. (c) Not found:
the deck is private now, so it's as if Sam had never seen it. The page sends Sam back to the deck
list.

</details>

## Recap

- **Policies** are small pure functions, shared by pages, use cases and queries.
- Say **"not found"** when admitting existence would leak; **"not allowed"** when it wouldn't.
- Feed events: **once**, in the **same transaction**, under a **lock**; forgotten when their
  target goes.
- **Soft delete** keeps a thread's shape; make the **constraint** describe both states.
- Shared resources aggregate with **max**, not sum.
- When two steps could apply the same adjustment, **one owns it**.

## Further reading

- [Design doc 21](../docs/design/21-sharing-decks.md): invariants 1–7.
- [Design doc 15](../docs/design/15-buy-a-list-and-card-search.md), decision 2: "only buy what I
  don't already own".
- OWASP, "Insecure Direct Object Reference": why existence can leak through error codes.
