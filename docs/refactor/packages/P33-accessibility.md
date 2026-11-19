# P33. Accessibility pass

- **Branch:** `refactor/P33-accessibility` · **Depends on:** P31, P32 · **Parallel with:** P20, P34
- **Source:** [plan review](../reviews/plan-review/README.md) (P33; owner answer "images"), report [3](../reviews/plan-review/3-app-and-ui.md), finding 9
- **Lines:** none stated. A `Dialog`, a `CardImage` and focus tokens add about 150 lines; the 27 raw `<img>` blocks and the ad-hoc confirm code remove about as many. Say the net in the handoff.

## Why

The basics are good (a skip link, `lang`, 161 `aria-label`s, 44px touch targets). The gaps:

- About 8 focus styles in the whole app.
- No dialog component and no focus trap.
- Destructive forms (deleting a deck, resetting a player, starting over) don't ask for
  confirmation, or ask in their own way.
- 27 raw `<img>` and no shared rules for `alt`, size and loading. The owner decided: **keep plain
  `<img>`** (the local image cache does the optimiser's job), behind **one documented
  `CardImage` component**.

## Deletes

| What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Where                                 | Lines       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------- |
| The 27 raw `<img>` blocks (`grep -rn "<img" src --include='*.tsx'`: among others `_components/{card-tile,card-preview}.tsx`, `ui/{product-image,opening/pack-opener}.tsx`, `decks/[id]/builder/{list/deck-list,suggestions/suggestions-panel,collection/grid-card,tokens/tokens-panel,selection/{printing-picker,selected-card},test-hand/test-hand-panel}.tsx`, `decks/commanders/commander-cards.tsx`, `decks/[id]/print/token-section.tsx`, `drafts/[id]/pick-grid.tsx`, `cards/[id]/page.tsx`, `inventory/page.tsx`, `wishlist/page.tsx`, `collection/real/page.tsx`) | those files                           | −80 to −150 |
| Ad-hoc confirm code: the "clear warning" in `account/start-over-form.tsx`, `admin/players/reset-form.tsx`, `decks/[id]/builder/snapshots/snapshots-panel.tsx` and any `window.confirm` or inline "are you sure" state (verify with `grep -rniE "confirm                                                                                                                                                                                                                                                                                                                   | are you sure" src --include='*.tsx'`) | those files | −40 to −80 |
| Per-component focus classes copied by hand (`focus:` / `focus-visible:` strings, 8 today)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `src/app`, `src/ui`                   | −10 to −20  |

## Touches

`src/ui/{card-image,dialog,confirm-button}.tsx` (the last from P31, extended), `src/app/globals.css`
(focus tokens), the files above, `tests/e2e/accounts.spec.ts` (or the area spec it becomes after
P20), `docs/architecture/conventions.md` (a short "Accessibility" section). **Avoid** page splits
(P32) and class-string migration (P31).

## Steps

1. **Focus styles from tokens.** In `globals.css`, one `:focus-visible` rule for interactive
   elements (outline from the `--focus-ring` token, 2px, offset 2px, visible in dark and light).
   Delete the 8 hand-written focus classes the rule replaces. Check by keyboard: Tab through the
   home page, the deck builder, and the store.
2. **`Dialog`.** A client component using the native `<dialog>` element (modal, `showModal()`),
   which traps focus and closes on Escape for free. Props: `open`, `onClose`, `title`, children.
   Return focus to the opener on close. Give it a test in the browser (e2e): opens, Tab stays
   inside, Escape closes, focus returns.
3. **`ConfirmButton`.** Built on `Dialog`: a button that opens it with a short question and a
   danger "Confirm" button. It submits its form only after the player confirms. Use it for every
   destructive form: delete a deck, remove all decks, reset a player, start over, sell a copy,
   delete a snapshot, revoke a token, decline or cancel a trade. Find them with
   `grep -rn "delete\|remove\|reset\|revoke\|cancel" src/app --include='actions.ts'`. Delete each
   form's own warning code in the same commit.
4. **`CardImage`.** One component: `src`, `alt` (required; the card name, or empty only for a
   purely decorative image, which the prop makes explicit), `width`/`height` (to stop layout
   shift), `loading="lazy"` unless told otherwise, a fallback tile when the image fails. A short
   comment at the top documents why plain `<img>` is used (the local cache serves resized
   images; `next/image` isn't needed). Replace the 27 raw `<img>` and delete each in the same
   commit. Lint: ban raw `<img` in `src/app` and `src/ui`, except inside `card-image.tsx`
   (`react/forbid-elements` or a `no-restricted-syntax` selector on `JSXOpeningElement[name.name='img']`).
5. **Labels and names.** Run a quick audit with the `design:accessibility-review` approach on the
   five busiest pages (home, store, collection, deck builder, draft). Fix what it finds that is
   small (missing `alt`, unlabeled icon buttons, contrast of `text-muted` on `bg-surface` in both
   themes). List what you could not fix.
6. **Test.** Add e2e checks: Tab reaches the confirm dialog and Escape closes it; the delete-deck
   form does not delete until confirmed. Don't snapshot images.
7. Check dark mode and phone width. `pnpm check`, `pnpm test:e2e`. `pnpm sizes --update`.

## What not to do

- Don't use `next/image`.
- Don't add a dependency for dialogs or focus traps. The native `<dialog>` is enough.
- Don't make confirm dialogs for reversible actions (add to wishlist, rename).
- Don't change colours (P31 owns them) except to fix a contrast failure, and then change the token.

## Done when

- `grep -rn "<img" src --include='*.tsx' | grep -v card-image.tsx` finds nothing.
- Every destructive form listed in step 3 uses `ConfirmButton`, and the e2e check that deleting a
  deck needs a confirmation passes.
- `grep -rc "focus:\|focus-visible:" src/app src/ui | grep -v ":0"` finds only `globals.css`
  and (documented) exceptions.
- `pnpm check` and `pnpm test:e2e` are green. The handoff has the net lines and the list of
  accessibility findings left open.

## Handoff

(empty)
