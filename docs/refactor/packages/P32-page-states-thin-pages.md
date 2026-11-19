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
9. Run `pnpm check`, `pnpm test:e2e`. Screenshot the root error and not-found pages in dark mode and
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
- `pnpm check` and `pnpm test:e2e` are green. The handoff has screenshots checked and the net lines.

## Handoff

(empty)
