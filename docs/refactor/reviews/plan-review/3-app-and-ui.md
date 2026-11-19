# Plan review 3: the app and UI layer

Read-only review by an agent, 2026-11-19, on `refactor/main` at `48f18af`. Its evidence is greps
and counts. It ran no tests and opened no browser.

## Findings, ranked

1. **Strength: the adapters stay thin, and lint enforces it.**
   - Only 4 `getContainer()` calls remain in `src/app`.
   - The builder's reducer is pure and tested (294 lines, 22 tests).
   - `deck-builder.tsx` is 280 lines.
2. **No `loading.tsx`, `error.tsx` or `not-found.tsx` anywhere** (0 across 51 pages).
   - A server error shows Next's own screen.
   - No Suspense or streaming: slow pages wait for every read before showing anything.
3. **No UI building blocks; Tailwind classes are copy-pasted.**
   - There are 1,055 raw `zinc-*` colour classes and 579 `dark:` classes, against only 5 colour
     tokens.
   - One button class string appears 13 times, and 11 pages define their own `field` string.
   - `src/ui/form.tsx` exists, but pages use it unevenly.
4. **Business and presentation logic sits in actions and pages.**
   - `decks/commanders/actions.ts` builds a view model.
   - `commanders/page.tsx` is 387 lines.
   - `drafts/[id]/page.tsx` is 645 lines and holds 8 or more components.
   - `commanderCardsAction` is a read done through a server action.
5. **Two ways to read form input.** 25 action files read `formData.get` by hand (134 calls). The
   rest use typed `action(schema, …)`.
6. **`revalidatePath` is written by hand 100 times**, with string literals. There are no cache tags.
7. **Files over 300 lines:**
   - `drafts/[id]/page.tsx` (645) and `players/[id]/page.tsx` (313)
   - `snapshots-panel` (481), `primer-panel` (430), `cuts-panel` (344) and `use-deck-changes`
     (351)
   - `pick-grid` (471), `pack-opener` (458) and `proxy-form` (354)
   - `drafts/actions.ts` (316) and `wishlist/actions.ts` (301)
8. **Where things go differs from area to area.**
   - Each builder panel has its own folder; collection, store and trades keep their files at the
     route root.
   - `src/ui` holds logic (`opening/machine.ts`, `sounds.ts`, `collection/options.ts`).
   - Shared card UI (tile, preview, filters) lives in `app/_components`.
9. **Accessibility: good basics, but patchy.**
   - Good: a skip link, `lang`, 161 `aria-label`s and 44px touch targets.
   - About 8 focus styles in total.
   - No dialog component and no focus trap.
   - Destructive forms (deleting a deck) don't ask for confirmation.
   - 27 raw `<img>` and no `next/image`.
10. **Money display is only partly shared.** `Cents.format` is the norm, but there is no `<Price>`
    component and no rule for showing an empty value.

## Conventions it recommends

- **A page:** calls `readPage()`, parses its params, calls capabilities and passes plain data down.
  It holds no rules and no local component over about 60 lines.
- **Where UI goes:** a route's own UI goes in its `_components/`. UI shared by two or more routes
  goes in `src/ui/<area>/`.
- **`src/ui`:** presentational building blocks only (Button, Field, Select, Card, Table,
  EmptyState, Price, Dialog, ConfirmButton). No logic.
- **Page states:** `loading.tsx` and `error.tsx` at the root and in each big section.
- **Actions:**
  - Every action uses `action(schema, handler)`, and form actions use a `formAction` twin.
  - They return a `Result`, never view models.
  - A `paths.ts` in each area owns its paths and what to revalidate.
- **Colour:** from tokens (`bg-surface`, `text-muted`, `--accent`, `--danger`), not raw `zinc-*`.

## Estimated saving

About 600 to 800 lines, mostly Tailwind class strings:

| Building block            | Lines saved | Note                                          |
| ------------------------- | ----------- | --------------------------------------------- |
| Button                    | about 150   |                                               |
| Field and Select          | about 150   |                                               |
| FilterBar                 | about 150   |                                               |
| Table                     | about 80    |                                               |
| Card                      | about 60    |                                               |
| Confirm button and Dialog | about 40    | also adds a confirmation to destructive forms |
| Price                     | small       | about 100 call sites                          |

## Packages it suggests

- **Tokens and building blocks:** migrate area by area.
- **Page states:** `loading.tsx`, `error.tsx`, `not-found.tsx` and Suspense.
- **Actions:** one form convention, `paths.ts`, and view models moved out of actions.
- **Thin pages:** split the large pages, with a lint limit on components per page.
- **Layout tidy:** settle `src/ui` against `_components`.
- **Accessibility pass:** focus styles, confirmations, a dialog component and an image policy.

## Questions for the owner

- **Raw `<img>`:** is it deliberate (a local image cache, no optimiser)? If so, one documented
  `CardImage` component.
- **Error pages:** custom ones, even though the app is self-hosted?
- **Reads through server actions:** keep them, or use route handlers or Suspense instead?
- **Colours:** design tokens, or keep zinc classes as the visual language?
- **Dark mode:** system preference only, or also a toggle?
