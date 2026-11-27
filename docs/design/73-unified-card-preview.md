# Design: unified card preview, carousel stepping & two-sided card flip

- **Phase:** 73
- **Status:** Approved and built (2026-11-27)
- **Related ADRs:** 0023 (design-first workflow)
- **Lesson:** no (unifies existing UI components, CSS 3D flip, and native `<dialog>`; no new domain or TypeScript concept)
- **Module pages:** [platform.md](../modules/platform.md) (shared UI primitives),
  [decks-core.md](../modules/decks-core.md) (public and shared deck previews),
  [game-collection.md](../modules/game-collection.md) (pack opener and card grids)

## 1. Purpose & scope

Make inspecting cards feel consistent, fast, and phone-first everywhere in Proxy Library:

1. **Public and shared deck pages (`/d/[token]`, `/decks/[id]`)** let visitors click or tap any card
   (in list view, visual view, or commander slot) to open a full card preview and step through the
   entire deck.
2. **Carousel navigation on the card itself**: wherever a previewed card belongs to a sequence
   (shared deck, deck builder, pack opening, or card grid), tapping/clicking the left or right edge
   of the card — or swiping horizontally on a phone, or pressing `ArrowLeft` / `ArrowRight` — moves
   to the previous or next card.
3. **Two-sided card flipping everywhere**: every card preview surface (including pack opening,
   public decks, deck builder, card grids, and `/cards/[id]`) lets you flip double-faced cards
   (`hasBackImage: true`) between front and back artwork, with 3D flip animation (respecting
   `prefers-reduced-motion`).

**Out of scope:**

- New database columns, migrations, or Scryfall sync changes: `PrintingCard.hasBackImage`,
  `PrintingCard.faces`, and `/api/images/[printingId]/[size]/[face]` already exist.
- Changing how draft pick grids (`src/app/drafts/[id]/_components/pick-grid.tsx`) select or draft
  cards (draft picks have their own double-click-to-pick and conspiracy choice panel; draft
  selected-card views can still gain flip support if they use `CardView`).
- Replacing desktop hover previews (`EnlargedCard`, `NamePreview`) — hover stays as a quick glance
  on pointer devices, while clicking opens the unified preview modal.

## 2. Findings that shape the design

1. **Public deck clicks are currently a no-op.** `SharedDeckView` passes `onSelect={() => undefined}`
   to `DeckList`. Because `onSelect` is defined, `NamePreview` calls it on click and suppresses the
   floating preview, leaving clicks dead in both list and visual views.
2. **Stepping is implemented twice with different UX.** The deck builder has `DeckSteps` (`‹ 3 / 100 ›`)
   in the header of `SelectedCard`; the pack opener has `PackSteps` below the card and a whole-card
   tap that only advances forward. Card grids (`CardTile`) have no stepping at all.
3. **Every preview hardcodes `/front`.** `CardView`, `CardWithPreview`, `CardTile`, `EnlargedCard`,
   `NamePreview`, and `pack-views.tsx` (`openerImageUrl`) all request `/front`. `OpenerCard` in
   `src/app/inventory/opened/_components/machine.ts` does not yet carry `hasBackImage`, even though
   `src/app/inventory/opened/page.tsx` already has the full `PrintingCard` map.
4. **`CardPreviewDialog` bypasses `src/ui/dialog.tsx`.** It renders its own `<dialog>` without
   `closedby="any"` or the Safari pointer-drag-safe backdrop-dismiss fallback, and each `CardTile`
   mounts its own `<dialog>` instance.
5. **Server-rendered card grids need a clean carousel boundary.** `SetPage`, `SinglesPage`,
   `CollectionCardGrid`, and `ProfileShowcase` are Server Components rendering `CardTile` children.
   A small client context wrapper (`CardPreviewGroup`) lets any server-rendered grid share a single
   carousel modal without rewriting those pages into client components.

## 3. Shared UI model & primitives

### 3.1 `CardStepping` (`src/ui/mtg/card-art.tsx`)

One shared stepping contract replaces `DeckStepping` and `PackSteps` prop duplication:

```ts
export type CardStepping = Readonly<{
  /** 1-based position in the sequence (0 when pack opener has no card revealed yet). */
  position: number;
  total: number;
  canGoPrevious?: boolean; // defaults to total > 1
  canGoNext?: boolean; // defaults to total > 1
  onPrevious: () => void;
  onNext: () => void;
}>;
```

### 3.2 `CardArt` (`src/ui/mtg/card-art.tsx`)

The single interactive card image stage used by `CardView`, `PackOpener` (`Spotlight` and
`RevealStack`), and `CardWithPreview`:

- **Props:** `printingId`, `name`, `size` (`"normal" | "large"`), `hasImage`, `hasBackImage`,
  `face` / `onFlip` (controlled or uncontrolled), `stepping?: CardStepping | null`, optional `overlay`
  (e.g. foil shimmer in pack opener), `className`.
- **Two-sided flip:**
  - Uses `.flip-card` / `.flip-inner` / `.flip-face` / `.flip-front` from `src/app/globals.css`
    (which already disables transition under `prefers-reduced-motion: reduce`).
  - Back image (`/api/images/${printingId}/${size}/back`) is only requested once the card is flipped
    (or preloaded for DFCs in `PackOpener`), avoiding unnecessary requests for unflipped cards.
  - When `hasBackImage` is true, renders a high-contrast **↻ Flip** pill button (`min-h-11 min-w-11`
    on coarse pointers, `aria-pressed={face === "back"}`, `aria-label="Flip card to back face"` /
    `"Flip card to front face"`), positioned at the **bottom-center** of the card image, clear of the
    left/right carousel tap zones.
  - Resets to `"front"` automatically whenever `printingId` changes (keyed or derived reset on
    card change).
- **Carousel tap zones & swipe:**
  - When `stepping` is provided and `total > 1`:
    - **Left tap zone** (left ~28% width, full height minus bottom flip-button clearance when DFC):
      `<button type="button" aria-label="Previous card">` with a subtle translucent `‹` chevron pill
      on the left edge.
    - **Right tap zone** (right ~28% width, same clearance): `<button type="button" aria-label="Next card">`
      with a subtle translucent `›` chevron pill on the right edge.
    - Chevrons are subtly visible by default on touch devices (`@media (hover: none)`) so users
      immediately discover they can tap the edges, and brighten on hover/focus on pointer devices.
    - When `canGoPrevious === false` or `canGoNext === false` (e.g. pack opening bounds), that edge
      button is disabled and visually muted/hidden.
    - **Horizontal swipe** on the card frame (`pointerdown` / `pointerup` or touch delta ≥ 44px with
      horizontal dominance over vertical scroll) triggers `onPrevious` (swipe right) or `onNext`
      (swipe left), without blocking vertical page/modal scrolling (`touch-action: pan-y`).

### 3.3 `CardView` (`src/ui/mtg/card-view.tsx`)

Upgraded to render `CardArt` instead of a static front-only `CardImage`:

- Accepts `hasBackImage?: boolean` and `stepping?: CardStepping | null`.
- Tracks active face (`"front" | "back"`) per `printingId` (resetting to `"front"` when `printingId`
  changes).
- In **Text** and **Both** modes (and desktop side-by-side text), keeps all faces readable and marks
  the currently active face on DFCs (e.g. subtle accent border + "Showing this side" / "Front" /
  "Back" label, with a Flip button also accessible when in Text-only mode on phones so you can still
  flip before switching back to Image).
- Compact position counter (`3 / 100`) shown in the header or directly below the card when stepping
  is active.

### 3.4 `CardPreviewDialog` (`src/app/_components/card-preview.tsx`)

Rebuilt on top of [`Dialog`](file:///home/jack/Projects/tcg-virtual-library/src/ui/dialog.tsx):

- Inherits native `<dialog>` `showModal()`, `closedby="any"` + Safari pointer-drag-safe backdrop
  dismiss, `overscroll-behavior: contain`, focus return, and `Esc` dismissal.
- Accepts `printing: PrintingCard`, `open: boolean`, `onClose: () => void`, and optional
  `stepping?: CardStepping | null`, plus optional `href?: string` (e.g. "View card page" link when
  previewing from a grid).
- Keyboard shortcuts while open:
  - `ArrowLeft` → `stepping.onPrevious()` (when `canGoPrevious`)
  - `ArrowRight` → `stepping.onNext()` (when `canGoNext`)
  - `f` / `F` → toggle front/back face (when `printing.hasBackImage`)
- **Phone layout:**
  - Uses `size="lg"` (or responsive compact width on phone, side-by-side on `md+`) so the card image
    with left/right tap zones, Flip pill, and Image/Text/Both toggle fits comfortably inside `88dvh`
    without double scrolling.

### 3.5 `CardPreviewGroup` (`src/app/_components/card-preview-group.tsx`)

A small client context provider for card grids:

- Props: `cards: readonly { printing: PrintingCard; href?: string }[]` and `children: ReactNode`.
- Holds `activeIndex: number | null` and renders **one** `CardPreviewDialog` for the whole grid
  with wrapping `stepping` (`position = activeIndex + 1`, `total = cards.length`).
- `CardTile` checks the context via `useCardPreviewGroup()`:
  - When inside a group, activating the tile on touch/narrow screens — or clicking it on desktop —
    opens the shared carousel modal at that tile's index.
  - When standalone (outside a group), falls back to its own single-card `CardPreviewDialog`.

## 4. Surface-by-surface integration

| Surface                                                                      | Files                                                                                                                                 | Carousel stepping?                                                                                                                                         | Two-sided flip?                                                                                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public & shared decks** (`/d/[token]`, `/decks/[id]`)                      | `shared-view.tsx`, `deck-list.tsx`                                                                                                    | Yes — walks `deckOrder(lines, grouping, headings)` wrapping at ends. Works from list view, visual view, and commander cards.                               | Yes (via `CardPreviewDialog` → `CardView` → `CardArt`)                                                                                                         |
| **Deck builder** (`/decks/[id]`)                                             | `selected-card.tsx`, `selection-sheet.tsx`, `deck-steps.tsx`                                                                          | Yes — adds left/right edge tap + swipe on `CardArt` alongside existing `ArrowLeft`/`ArrowRight` and compact counter.                                       | Yes (passes `detail?.hasBackImage ?? false` into `CardView`, plus `F` shortcut)                                                                                |
| **Pack opener** (`/inventory/opened?animate=1`)                              | `opened/page.tsx`, `machine.ts`, `pack-opener.tsx`, `pack-views.tsx`                                                                  | Yes — `RevealStack` (phone) & `Spotlight` (desktop) use left/right tap zones + swipe to step back through revealed cards or flip/advance to the next card. | Yes — `OpenerCard` gains `hasBackImage`; `PackOpener` preloads back images for DFCs; Flip pill appears on revealed DFCs in both `RevealStack` and `Spotlight`. |
| **Card grids** (Sets, Collection, Singles, Opened results, Profile showcase) | `sets/[code]/page.tsx`, `collection/card-grid.tsx`, `singles/page.tsx`, `opened-results.tsx`, `profile-showcase.tsx`, `card-tile.tsx` | Yes — wrapped in `CardPreviewGroup` so tapping any card opens the carousel lightbox for that grid/section.                                                 | Yes (via `CardPreviewDialog` → `CardView`)                                                                                                                     |
| **Card detail page** (`/cards/[id]`)                                         | `cards/[id]/page.tsx`                                                                                                                 | No (single card page)                                                                                                                                      | Yes — passes `hasBackImage={card.hasBackImage}` to `CardView`.                                                                                                 |
| **Commander card preview** (`CardWithPreview`)                               | `card-preview.tsx`                                                                                                                    | Optional (when inside `SharedDeckView`, opens deck carousel at that commander; standalone in store stays single-card)                                      | Yes — flip pill on the modal preview (and inline if desired).                                                                                                  |

## 5. Invariants

1. **Single-faced cards never show a flip control.** When `hasBackImage` is false, no Flip button is
   rendered and `/back` is never requested.
2. **Stepping resets face to front.** Moving to a different `printingId` always shows the front face
   first.
3. **Flip never triggers stepping.** Tapping the Flip button stops propagation and sits outside the
   left/right step zones so flipping a DFC never advances or rewinds the carousel.
4. **No hover-only controls.** Every action (step previous/next, flip, close, toggle image/text) is
   visible and reachable via touch (`≥ 44px` target on coarse pointers) and keyboard.
5. **Reduced motion respected.** Under `prefers-reduced-motion: reduce`, flipping switches faces
   without 3D rotation animation.
6. **Public deck privacy preserved.** Public `/d/[token]` previews use only the `cards` map already
   loaded for the public deck; no authenticated server actions are invoked.

## 6. Test plan

- **Unit tests (Vitest):**
  - Pure swipe-detection helper (horizontal threshold, vertical-scroll rejection, direction).
  - Pure face-state / stepping index helpers (wrapping vs bounded stepping, face reset on card
    change).
  - Existing `opened-summary.test.ts` / `machine.test.ts` updated for `OpenerCard.hasBackImage`.
- **Verification (`pnpm check`):**
  - Typecheck, ESLint (architecture rules, no raw `<img>`, full-word naming), cycle check, Prettier,
    unit tests, knip/size ratchets.
- **E2E / manual mobile & desktop verification:**
  - Public deck page (`/d/[token]`): click card in list view & visual view → modal opens, left/right
    edge tap steps through deck in `deckOrder`, double-faced card flips front↔back, Escape and
    outside-click dismiss cleanly.
  - Pack opener: reveal a DFC, flip it in both mobile `RevealStack` and desktop `Spotlight`, tap
    left/right edges to step back/forward.
  - Card grid (e.g. Set page or Collection): tap card on narrow viewport → carousel steps through
    grid; flip DFC; close returns focus to tile.
