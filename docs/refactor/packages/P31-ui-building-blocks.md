# P31. UI building blocks and colour tokens

- **Branch:** `refactor/P31-ui-blocks` · **Depends on:** P25, P30 · **Parallel with:** P34 (P32 and P33 follow this package)
- **Source:** [plan review](../reviews/plan-review/README.md) (P31; owner answer 5 and the UI answers), report [3](../reviews/plan-review/3-app-and-ui.md)
- **Lines:** −600 to −800, mostly repeated Tailwind class strings.

## Why

There are about 1,100 raw `zinc-*` colour classes and 579 `dark:` classes in `src/app`, against five
colour tokens. One button class string appears 13 times, and 12 files define their own `field`
string. `src/ui/form.tsx` exists but pages use it unevenly. The owner decided (answers 5 and the UI
answers): a small set of shared components in `src/ui`; **no long repeated class strings in
pages**; design tokens (`surface`, `muted`, `accent`, `danger`, …) in place of raw `zinc-*`; dark
mode follows the system setting only (no toggle); plain `<img>` stays (P33 wraps it).

## Deletes

Counts from report 3, re-checked on `refactor/main`:

| What                                                                                                                                                                                                                                                                                                                                                                                                                                      | Where                                                            | Lines                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------- |
| The 13 copies of one button class string                                                                                                                                                                                                                                                                                                                                                                                                  | `grep -rn "<the button string>" src/app` (find it first, step 1) | about −150                    |
| 12 local `const field = …` definitions (`drafts/page.tsx:11`, `decks/page.tsx:9`, `decks/[id]/page.tsx:24`, `drafts/[id]/{pick-grid:32, conspiracy:192 and 243}`, `singles/list/list-buyer.tsx:12`, `wishlist/wish-forms.tsx:21`, `_components/card-filters.tsx:36`, `collection/real/import/importer.tsx:17`, `trades/new/draft-controls.tsx:50`, `decks/[id]/builder/primer/primer-panel.tsx:122`) and their class strings at every use | those files                                                      | about −150 (Field and Select) |
| Filter-bar copies                                                                                                                                                                                                                                                                                                                                                                                                                         | `_components/card-filters.tsx` and the other filter forms        | about −150                    |
| Table class copies                                                                                                                                                                                                                                                                                                                                                                                                                        | the table pages (collection, store, wallet, admin)               | about −80                     |
| Card (panel) class copies                                                                                                                                                                                                                                                                                                                                                                                                                 | pages with `rounded-lg border …` boxes                           | about −60                     |
| Confirm button and dialog copies                                                                                                                                                                                                                                                                                                                                                                                                          | forms with their own confirm text                                | about −40                     |
| Raw `zinc-*` + `dark:` pairs replaced by tokens                                                                                                                                                                                                                                                                                                                                                                                           | all of `src/app`, `src/ui`                                       | counted in the rows above     |
| `<Price>`: about 100 call sites that format money by hand                                                                                                                                                                                                                                                                                                                                                                                 | grep `Cents.format` in `src/app`                                 | small                         |

## Touches

`src/app/globals.css` (the tokens), new `src/ui/{button,field,select,card,table,dialog,confirm-button,price,empty-state,filter-bar}.tsx`,
`src/ui/form.tsx`, and every page and component that uses the old strings (area by area).
**Avoid** page splitting and page states (P32), accessibility changes beyond what the new blocks
carry (P33), and `src/ui/{opening,collection}` logic (it is moved in P32).

## Steps

1. **Measure.** Save to the scratchpad: the number of `zinc-` classes, `dark:` classes, `field`
   definitions, and the most repeated class strings
   (`grep -rhoE 'className="[^"]{60,}"' src/app | sort | uniq -c | sort -rn | head -30`). This is the
   shopping list.
2. **Tokens.** In `globals.css`, add semantic tokens as CSS variables with a dark value each
   (dark follows `prefers-color-scheme` only): `surface`, `surface-raised`, `border-subtle` (exists),
   `muted` (exists), `foreground`, `accent`, `accent-foreground`, `danger`, `success`, `warning`,
   and the focus ring. Map them in `@theme inline`, so `bg-surface`, `text-muted`, `bg-accent` work
   and **no `dark:` is needed for them**. Don't add a toggle.
3. **Build the blocks, one commit each, with the first area migrated in the same commit** (the
   rule: add and delete together). Each block is presentational only, no logic, a few props, and
   takes `className` for the rare override:
   - `Button` (variants `primary`, `secondary`, `danger`, `quiet`; sizes; a `pending` state beside
     `src/ui/form.tsx`'s `SubmitButton`),
   - `Field` and `Select` (label, hint, error, the one text-field class),
   - `Card`, `Table`, `EmptyState`, `Price` (shows an empty value one way: an em dash),
   - `FilterBar`, `ConfirmButton` (a button that asks first; P33 adds the dialog),
   - `Dialog` is **P33**. `ConfirmButton` in this package uses the browser's `confirm()` only as
     a placeholder if it has to; prefer waiting for P33 and leaving destructive forms as they are.
4. **Migrate area by area**, one commit per area: auth and account, wallet, store and singles,
   collection, wishlist, trades, friends and players, admin, drafts, decks (list and commanders),
   the deck builder panels last. Each commit replaces the strings with the blocks, deletes the local
   `field` constants and the zinc classes it covered, and shows no visual change.
5. **Screenshots.** After each area, check the pages in the browser in **dark mode and at phone
   width** (the owner's habit; see `docs/screenshots` for the way). Look for lost borders,
   contrast and wrapped buttons. Real-data edge cases: long names, empty lists.
6. **Lint.** Add a `no-restricted-syntax` rule in `eslint.config.mjs` for `src/app/**`: a
   `className` string literal longer than 100 characters, or one that contains `zinc-` , is an
   error ("use a block from src/ui or a token"). Allow-list files that aren't migrated yet in a
   sorted list `NOT_YET_ON_BLOCKS`, which only shrinks; it must be empty at the end.
7. Run `pnpm check`, then `pnpm test:e2e` (selectors may use text and roles, so most should
   still pass). `pnpm sizes --update`.

**A feature in this package (owner, 2026-11-20): the card view on phones.** One `CardView`
building block replaces the card detail views (`app/_components/card-preview.tsx`, the builder's
`selection/selected-card.tsx` and `selection-sheet.tsx`, the card page's top section where it
fits):

- On a phone, tapping a card opens it **large, image only, text hidden** by default, so the card
  can be seen clearly.
- A toggle switches between **image**, **text** (the Oracle text, type line and so on) and
  **both** (the image above the text). Remember the choice per device (localStorage, guarded by
  try/catch; it falls back to "image" on a phone and today's layout on a desktop).
- Desktop keeps today's layout unless the owner asks otherwise.
- Keyboard and screen-reader friendly: the toggle is a labelled group of buttons, and the text
  stays available to screen readers when hidden visually only if that matches today's behaviour
  (check it).
- This changes how a page looks, so it's the one exception to "don't change layout" below. Its
  lines are reported separately (a feature). Add a by-eye check (dark mode, phone width, all three
  modes) to `deferred-checks.md`.

## What not to do

- Don't change layout or behaviour. A migration that changes how a page looks is a bug.
- Don't add logic to `src/ui`. Move logic out of it only in P32.
- Don't add a dark-mode toggle or a second theme.
- Don't create a block that is used in one place.

## Done when

- `grep -rc "zinc-" src/app src/ui | grep -v ":0"` lists only the token definitions (and tests).
- `grep -rn "const field" src --include='*.tsx'` finds nothing.
- The lint rule is on and `NOT_YET_ON_BLOCKS` is empty (deleted).
- `pnpm check` and `pnpm test:e2e` are green. The sizes baseline is lowered. The handoff lists the
  blocks, the lines removed per area, and the dark and phone screenshots checked.

## Handoff

(empty)
