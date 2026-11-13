# Design: PWA & UI Polish

- **Phase:** 49
- **Status:** Approved (2026-11-12)
- **Related ADRs:** 0016 (client-safe module API), 0023 (process sized to the feature)
- **Lesson:** no

## 1. Purpose & scope

Upgrade Proxy Library's UI, design tokens, and Progressive Web App (PWA) behavior so the app feels cohesive, accessible, and reliable across desktop, mobile touch screens, and installed standalone windows.

**In scope:**

- Semantic CSS design tokens (`--color-muted`, `--color-surface`, `--color-border`) in [globals.css](file:///home/jack/Projects/tcg-virtual-library/src/app/globals.css) and migrating `text-zinc-500` occurrences in `src/app/` so dark-mode contrast consistently meets WCAG AA (≥ 4.5:1).
- Coarse-pointer touch target sizing (`44×44` CSS px minimum) and safe-area inset padding (`viewportFit: "cover"`, `env(safe-area-inset-*)`) for notched devices in standalone mode.
- Navigation & wayfinding improvements: `aria-current="page"` active indicators, light-dismiss on [PhoneMenu](file:///home/jack/Projects/tcg-virtual-library/src/app/_components/phone-menu.tsx) via native `popover`, surfacing [InstallAppButton](file:///home/jack/Projects/tcg-virtual-library/src/app/_components/install-app-button.tsx) outside `/account`, and an optional compact standalone mobile bar.
- Touch-friendly card inspection for [CardTile](file:///home/jack/Projects/tcg-virtual-library/src/app/_components/card-tile.tsx) / [EnlargedCard](file:///home/jack/Projects/tcg-virtual-library/src/app/_components/card-preview.tsx) using a native `<dialog>` sheet on coarse-pointer / narrow viewports.
- Offline fallback and immutable card-image caching in [sw.js](file:///home/jack/Projects/tcg-virtual-library/public/sw.js), plus `shortcuts` in [manifest.ts](file:///home/jack/Projects/tcg-virtual-library/src/app/manifest.ts).

**Out of scope:**

- Backend modules, database schema, or domain logic (`src/modules/*`).
- Offline mutations or client-side IndexedDB sync (live drafts via SSE, wallet, trades, and auth remain network-only).
- Manual light/dark theme toggle UI (continues to follow OS `prefers-color-scheme`).

## 2. Ubiquitous language

| Term                     | Meaning in this codebase                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Standalone mode**      | Installed PWA running outside browser chrome (`(display-mode: standalone)` or iOS `navigator.standalone`). |
| **Coarse pointer**       | Touch-primary input device matched by `@media (pointer: coarse)`.                                          |
| **Safe-area inset**      | System-reserved edge spacing (`env(safe-area-inset-*)`) for notches, rounded corners, and home indicators. |
| **Immutable card image** | Cached printing artwork served from `/api/images/<printingId>/<size>/<face>`.                              |

## 3. Invariants

1. **WCAG AA contrast in both themes:** Muted text and UI boundaries meet ≥ 4.5:1 (normal text) and ≥ 3:1 (non-text/large text) against both `#ffffff` (light) and `#0a0a0a` (dark).
2. **Touch target floor:** On `@media (pointer: coarse)`, interactive controls (`button`, `select`, `input`, `nav a`, `summary`) have a minimum hit area of `44×44` CSS px without causing horizontal overflow at `320px` viewport width.
3. **Freshness for dynamic routes:** `sw.js` never serves stale cached responses for HTML/RSC navigations when online, SSE streams (`/api/drafts/...`), auth, or server actions (`POST`).
4. **Offline resilience:** When a navigation request fails offline, `sw.js` serves a precached offline fallback page rather than the browser's generic error page.
5. **Reduced motion & forced colors:** Animations and `box-shadow` highlights degrade gracefully under `prefers-reduced-motion: reduce` and `forced-colors: active`.

## 4. UI & PWA architecture

### 4.1 Design tokens (`src/app/globals.css`)

Define semantic tokens on `:root` using `light-dark()` with `@media (prefers-color-scheme: dark)` fallbacks, and expose them to Tailwind v4 via `@theme inline`:

- `--muted`: `#52525b` (light) / `#a1a1aa` (dark) → `text-muted`
- `--surface`: `#f4f4f5` (light) / `#18181b` (dark) → `bg-surface`
- `--border-subtle`: `#e4e4e7` (light) / `#27272a` (dark) → `border-subtle`

Replace ~303 standalone `text-zinc-500` classes in `src/app/` with `text-muted` (or `text-zinc-600 dark:text-zinc-400`).

### 4.2 Form-factor & safe-area adaptation (`src/app/layout.tsx`, `globals.css`)

- Add `viewportFit: "cover"` to `viewport` in `src/app/layout.tsx`.
- Apply `padding-inline: env(safe-area-inset-left)` / `env(safe-area-inset-right)` and bottom safe-area padding on fixed/sticky chrome.
- Set `--target-size: 24px` at `:root` and `--target-size: 44px` inside `@media (pointer: coarse)` for `nav a`, `button`, `summary`, `select`, and non-checkbox/radio `input`s inside `@layer base`.

### 4.3 Navigation & install discoverability (`site-header.tsx`, `phone-menu.tsx`, `install-app-button.tsx`)

- Extract a small `"use client"` `NavLink` wrapper using `usePathname()` to set `aria-current="page"` and an active underline/pill style.
- Upgrade `PhoneMenu` from `<details>` to a native `popover` menu (`popover="auto"` + `popoverTarget` on the trigger `<button>`) for built-in `Escape` and outside-tap light-dismiss, while still closing on route change.
- Include a compact `InstallAppButton` variant inside `PhoneMenu` (rendered only when `canInstall && !installedViaWebInstall`), keeping the full section on `/account`.
- Render a fixed/sticky bottom navigation bar on mobile (`md:hidden`) for the 5 primary destinations (`Store`, `Inventory`, `Collection`, `Decks`, `Drafts`), padded with `env(safe-area-inset-bottom)` and paired with bottom clearance on the page body/footer so content is never obscured.

### 4.4 Touch-friendly card preview (`card-tile.tsx`, `card-preview.tsx`)

- Keep the existing hover/focus `EnlargedCard` overlay for fine pointers (`@media (pointer: fine)` / desktop).
- On coarse pointers or narrow screens, tapping a card's preview trigger opens a native `<dialog>` (`showModal()`) containing the card image, scrollable `FaceText` (for long or double-faced cards), and a `44×44` Close button. Light-dismiss / `Escape` is handled natively by `<dialog>`.

### 4.5 Service worker & manifest (`public/sw.js`, `src/app/manifest.ts`)

- **`public/sw.js`:**
  - Precache `/offline.html` (static, self-contained HTML/CSS with `color-scheme: light dark`) on `install`.
  - On `fetch`:
    - Skip non-`GET` requests and SSE/API mutations.
    - For `/api/images/*`: `CacheFirst` (or `StaleWhileRevalidate`) in an `images-v1` cache capped at **500 entries** (evicting oldest entries when full), since printing artwork is immutable.
    - For `request.mode === "navigate"`: `NetworkFirst`, falling back to `/offline.html` on network failure.
- **`src/app/manifest.ts`:**
  - Add `shortcuts` for `/store`, `/inventory`, `/decks`, and `/drafts`.

## 5. Test plan

- **Unit tests:** Update/extend [manifest.test.ts](file:///home/jack/Projects/tcg-virtual-library/src/app/manifest.test.ts) to verify `shortcuts` and manifest fields.
- **Typecheck & lint:** `pnpm check` (`typecheck`, `lint`, `lint:cycles`, `format:check`, unit tests).
- **E2E / Playwright (`tests/e2e/`):**
  - Verify `PhoneMenu` opens, closes on `Escape` and outside click, and closes on navigation at mobile viewport (`390×844`).
  - Verify `sw.js` registers cleanly and `/offline.html` renders when offline.
  - Verify `CardTile` opens the `<dialog>` preview on tap in a touch-emulated context and closes via button/`Escape`.
- **Manual checks:** Verify light/dark contrast, `320px` reflow, `44px` touch targets, and standalone install flow in Chrome/mobile DevTools.
