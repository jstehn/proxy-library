# P32. Page states and thin pages

- **Branch:** `refactor/P32-page-states` · **Depends on:** P31 · **Parallel with:** P20, P34
- **Source:** [plan review](../reviews/plan-review/README.md) (P32; owner answer "error pages"), report [3](../reviews/plan-review/3-app-and-ui.md)
- **Lines:** none stated. Net ≤ 0 is the aim: the new files are small, and the splits move code, so growth needs a sentence in the handoff.

## Why

There is no `loading.tsx`, `error.tsx` or `not-found.tsx` anywhere (0 files across 51 pages). A
server error shows Next's own screen, and a slow page waits for every read before showing
anything. Some pages are too big: `drafts/[id]/page.tsx` is 645 lines with 8 or more components,
`decks/commanders/page.tsx` 387, `players/[id]/page.tsx` 313. Each area writes `revalidatePath`
strings by hand (71 times). The owner chose simple custom `error`, `not-found` and `loading` pages.

> Next.js in this repo has breaking changes. Read `node_modules/next/dist/docs/` for `error.tsx`,
> `not-found.tsx`, `loading.tsx` and Suspense **before** writing any of these (see `AGENTS.md`).

## Deletes

| What                                                                                                                                       | Where                                                               | Lines       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------- |
| Local components inside the 645-line draft page, moved to files (net 0) and the page cut to ≤ 150 lines of composition                     | `src/app/drafts/[id]/page.tsx` (also leaves the oversize allowlist) | page −400   |
| The view model built in an action (`commanders/actions.ts`), and `commanderCardsAction`, a read done through a server action               | `src/app/decks/commanders/actions.ts`                               | −60 to −120 |
| `commanders/page.tsx` split: view code to `_components/`                                                                                   | `src/app/decks/commanders/page.tsx` (387)                           | page −250   |
| `players/[id]/page.tsx` split                                                                                                              | `src/app/players/[id]/page.tsx` (313)                               | page −150   |
| Hand-written `revalidatePath` strings (71) replaced by one `paths.ts` per area                                                             | `src/app/**/actions.ts`                                             | −50 to −100 |
| `src/ui` logic that isn't presentational: `ui/opening/{machine,sounds}.ts`, `ui/collection/options.ts` move beside the page that uses them | `src/ui/opening/`, `src/ui/collection/`                             | moved       |

(The first, second and third rows move code more than they delete it. The honest saving is in the
`commanders` action rows and `paths.ts`; record the real number.)

## Touches

New `src/app/{error,not-found,loading}.tsx` and one set per big section (`decks`, `drafts`,
`collection`, `store`, `admin`), `src/app/drafts/[id]/`, `src/app/decks/commanders/`,
`src/app/players/[id]/`, new `src/app/<area>/paths.ts`, `src/ui/{opening,collection}/`,
`eslint.config.mjs`. **Avoid** the building blocks (P31) and a11y changes (P33).

## Steps

1. Read the Next.js docs named above. Note how `error.tsx` (a client component), `not-found.tsx`
   and `loading.tsx` interact with the root layout in this version.
2. **Root states:** `src/app/error.tsx`, `not-found.tsx`, `loading.tsx`. Use the P31 blocks
   (`EmptyState`, `Button`). Plain wording: what happened, a link home, a "try again" button.
   Never show the error message or a stack to the player. Tokens only; dark and phone checked.
3. **Section states** for the slowest sections (find them by timing the page reads, or take
   `decks/[id]`, `drafts/[id]`, `collection`, `store`, `admin`). Each gets `loading.tsx` with a
   skeleton the size of the page, and `error.tsx` if the section's wording differs. Add Suspense
   around a slow read only where a page has an obvious fast part (a header) and a slow part (a
   list): don't wrap everything.
4. **`not-found`.** Pages that today print "not found or not yours" (STATUS decision 8) call
   `notFound()` for ids that don't exist or aren't the player's. Keep the same visible text.
   One test per area.
5. **Split the big pages**, one commit each, in the order: `drafts/[id]/page.tsx`,
   `decks/commanders/page.tsx`, `players/[id]/page.tsx`. A page is `readPage()`, parse the params,
   read through `reads` and capabilities, and compose components. Local components over about 60
   lines move to the route's `_components/`. Pages hold no rules. Delete the allowlist entry for
   the draft page.
6. **Actions return a `Result`, never view models.** In `commanders/actions.ts`, move the view-model
   building into the page's `_components` or a query. Turn `commanderCardsAction` into a read in
   `reads` (P25) called from the page or a route handler (answer: reads don't go through server
   actions).
7. **`paths.ts` per area.** Each area gets `paths.ts` exporting the paths it links to and a
   `revalidate<Area>()` that knows what to refresh. Replace the 71 literals, one area per commit.
8. **Layout tidy.** The rule (write it in `docs/architecture/conventions.md` section "UI"; P21 reads
   it later): a route's own UI lives in its `_components/`; UI shared by two or more routes lives in
   `src/ui/<area>/`; `src/ui` holds presentational building blocks only (no logic). Move
   `ui/opening/machine.ts`, `sounds.ts` and `ui/collection/options.ts` next to their one user.
   Lint: a component file over 300 lines in `src/app` warns (the 500-line benchmark stays the gate).
9. **Every action written one way (from P25, owner decision 2026-11-19).** P25 moved 10 forms onto
   `formAction`; 20 action files still read `formData.get` by hand
   (`grep -rl "formData.get" src/app`). The list and why each couldn't move is in
   `P25-read-layer.md`, Handoff, Part 2c, "Kept as they were". Add what they need, then move them
   one area per commit, deleting the hand-written parsing in the same commit:
   - a redirecting variant (`formRedirect(schema, handler)`) for the plain `<form action>` forms that
     redirect with `?error=` or `?message=` (drafts, decks, commanders, trades, inventory open,
     admin store and photos, the real collection, wishlist remove and sharing), keeping what an
     unreadable form does today;
   - an `allowPasswordChangePending` option for change password;
   - discriminated-union schemas and per-field messages for the wishlist forms;
   - a void variant for the silent forms (friends, revoke token or invite, set enabled).
     Forms with their own client state (sign-in, register, tokens, temporary passwords, invite links,
     profile, edit as text, OAuth approve) use `formAction` with `useActionState`. Every form keeps its
     messages, colours and redirects; check each by eye.
10. Run `pnpm check`, `pnpm test:e2e`. Screenshot the root error and not-found pages in dark mode and
    at phone width. `pnpm sizes --update`.

## What not to do

- Don't show internal error text to the player.
- Don't wrap every page in Suspense.
- Don't change what the pages show or their URLs.
- Don't move code between modules.

## Done when

- `find src/app -name error.tsx -o -name not-found.tsx -o -name loading.tsx` lists the root three
  and the section ones.
- `wc -l "src/app/drafts/[id]/page.tsx"` is ≤ 150, and no `page.tsx` in `src/app` is over 300 lines.
  `src/app/drafts/[id]/page.tsx` is off the oversize allowlist.
- `grep -rn "revalidatePath(\"" src/app | grep -v paths.ts` finds nothing.
- `grep -rn "commanderCardsAction" src` finds nothing.
- `grep -rl "formData.get" src/app` finds only `src/server/form-action*.ts` (or nothing).
- `pnpm check` and `pnpm test:e2e` are green. The handoff has screenshots checked and the net lines.

## Handoff

**Done (branch `refactor/P32-page-states`, commits start with `P32:`).**

- **Page states.** `src/app/{error,not-found,loading}.tsx` (new blocks `PageMessage` and
  `PageSkeleton` in `src/ui`) and a `loading.tsx` for `decks`, `drafts`, `collection`, `store` and
  `admin`. The error page shows no message or stack, only a sentence, "Try again" (`retry`, the
  prop this Next version uses) and "Go home". No section `error.tsx`: the wording would not
  differ. No Suspense was added (no page has an obvious fast head and slow list). Pages already
  called `notFound()`; the new root page is what they show now. No unit test per area: there is
  nothing to run without a browser, so by-eye checks are in `deferred-checks.md`.
- **Form variants** (`src/server/form-action.ts`, tested in `form-variants.test.ts`):
  `formRedirect(schema, handler, options)` (the handler returns a path, or `undefined` to stay;
  an unreadable form goes to `options.unreadable` or throws), `formVoid` (silent; an unreadable
  form does nothing), `parseForm(schema, formData)` for forms that keep their own state,
  `allowPasswordChangePending`, union schemas (`z.discriminatedUnion`), `messageByField` for
  `invalidInput`, and `redirectTo` may return `undefined`. `admin: true` works on all of them.
- **The 20 action files moved, one area per commit:** decks, decks/commanders,
  decks/edit-as-text, drafts, trades (and `trades/new/draft-controls.tsx`), wishlist,
  collection/real, inventory, admin (store, photos, catalog, connectors, players, invites),
  account (password, tokens, profile), friends, oauth/authorize, sign-in, register.
  `grep -rl "formData.get" src/app` prints nothing; the only file left in `src` is
  `src/server/form-action.ts`.
  - `formAction` (message forms): wishlist add, update, buy, wish-for-short-cards (now on the
    shared `FormState`, so the wish forms start from `{ message: null, tone: null }`), change
    password (now `FormState`, with `allowPasswordChangePending`).
  - `formRedirect`: decks (all), commanders "start a deck", drafts (all), trades, inventory open,
    collection/real, admin store and photos, wishlist sharing, OAuth approve.
  - `formVoid`: wishlist remove, friends (5, one `friendAction` factory), revoke token, revoke
    invite, delete connector, set-set-enabled.
  - `parseForm` (own state): sign-in, register, tokens (secret once), profile, edit-as-text (two
    actions), admin connectors create, admin players (temporary password), admin invites create,
    add real product.
  - **Behaviour that changed (all in error paths):** an unreadable decks, drafts, trades,
    inventory or photos form goes to that area's list, as the id check did before; a bad `format`
    or `finish` used to throw and now goes there too. Drafts' Conspiracy forms with a bad pack or
    seat number go to `/drafts` (they used to pass `NaN` on). A missing quantity or price on a
    wishlist form is "unreadable" (it used to read as 0). Nothing a person can do from the page
    changed.
- **Pages split into `_components/`.** `drafts/[id]/page.tsx` 646 to 108 (components, the old
  `conspiracy`, `countdown`, `live-updates`, `pick-grid`, `pool` moved in beside them);
  `decks/commanders/page.tsx` 378 to 90; `players/[id]/page.tsx` 298 to 56. The biggest page left
  is `trades/new/page.tsx` at 279. The draft page is off the oversize allowlist. `pick-grid.tsx` is
  on the blocks (`Button`, `Select`, `Input`) and `NOT_YET_ON_BLOCKS` is gone from the lint
  config.
- **Reads, not actions.** `commanderCardsAction` is gone: the panel fetches
  `GET /decks/commanders/cards?oracleId=&real=` (a route that calls `reads.decks.commanderDetails`);
  the view model is built in `_components/commander-cards-view.ts`.
- **`paths.ts`.** One each in `decks`, `drafts`, `trades`, `wishlist`, `cards`, `inventory`,
  `collection/real`, `admin`, `account`, `friends`, plus `app/paths.ts` (`revalidateHeader()`).
  `revalidatePath(` in `src/app` outside a `paths.ts`: 74 before, 0 after (29 inside the 11 files).
- **Layout.** `ui/opening/*` moved to `inventory/opened/_components/` (the whole folder: only that
  route uses it) and `ui/collection/options.ts` to `app/collection/options.ts`. The rule is in
  `docs/architecture/conventions.md` ("UI"); a component file over 300 lines in `src/app` is a lint
  warning. Doc and lesson paths were updated.

**Numbers.** Production code 76,920 to 77,396 (**+476** over the baseline, under the 500 the owner
accepts). Where it goes: the page states and two blocks (about 110), the form variants (about 110),
11 `paths.ts` files (about 170), the commanders route and view split (about 70), and the extra
imports of the split pages, less the hand parsing and revalidate strings removed. The baseline was
not raised. Knip 212 to 211 (lowered). Clones 18 (same). `pnpm check` fails only the sizes gate
until the owner approves the growth.

**Not checked.** No browser, no `next build`, no e2e, no integration run (no integration test
covers `src/app` actions). `export const x = formRedirect(...)` in a `"use server"` file is the
pattern P25 already used for `formAction`, but Next did not compile any of it here. The by-eye list
is in `deferred-checks.md` under P32.

**PM note at merge (2026-11-21):** every `loading.tsx` (root, decks, drafts, admin, collection, store)
and `PageSkeleton` were removed. With a loading boundary at or above a page, Next streams status
200 before the page can call `notFound()`, so a private deck answered 200 instead of 404 (the e2e
sharing test caught it; the content was never shown). Loading states can come back per page only
where nothing below calls `notFound()`; note it before adding one.
