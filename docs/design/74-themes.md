# Design: extensible theming system (palettes & MTG planes)

- **Phase:** 74
- **Status:** Approved and built (2026-11-27)
- **Related ADRs:** 0007 (external data ACL), 0009 (lint-enforced boundaries), 0015 (WPN product imagery), 0016 (client-safe module API), 0023 (design-first workflow)
- **Lesson:** yes (const-tuple union types & exhaustive `Record<ThemeId, T>` registries, Tailwind v4 `@custom-variant` & CSS cascade tokens, SSR cookie-mirrored preferences without FOUC, WCAG relative-luminance contrast math)
- **Module pages:** [platform.md](../modules/platform.md) (theme registry, CSS tokens, typography/shape primitives, artwork backdrop), [accounts.md](../modules/accounts.md) (appearance preference & cookie sync), [catalog.md](../modules/catalog.md) (`artCrop` image endpoint & WPN key-art lookup)

## 1. Purpose & scope

Let players customize Proxy Library's look and feel with an extensible, curated theming system supporting both **simple color palettes** (e.g., Catppuccin Latte & Mocha) and **MTG plane themes** (e.g., Bloomburrow, Innistrad, Kamigawa, New Capenna) that combine custom palettes, official artwork backdrops (WPN key art or Scryfall `art_crop`), and per-plane typography and corner shapes.

In v1, a player's chosen theme is **account-level and site-wide**: it persists on their profile, syncs across devices, and applies to every page they visit with zero flash of un-themed content (FOUC). All CSS scoping uses `[data-theme]` / `[data-color-scheme]` attributes so a future **Steam-style public profile** phase (per-profile themes alongside featured cards and decks on `/players/[id]`) can layer on without refactoring the theme engine.

**Out of scope (v1):**

- **Public profile theme overrides on `/players/[id]`**: deferred to a future Steam-profile showcase phase.
- **User-uploaded backgrounds or arbitrary card-picker backgrounds**: v1 uses curated presets only.
- **Wave 2 planes (Ravnica, Ixalan, Theros, Nauctis)**: added as 1-file presets once v1 ships (and once Nauctis's set/key art syncs).
- **Persistent header dark-mode toggle**: theme selection lives in `/account/appearance` (progressive disclosure, keeping the nav bar uncluttered).

## 2. Ubiquitous language

| Term                                 | Meaning in this codebase                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Theme ID** (`ThemeId`)             | Closed string union of registered curated theme identifiers in `@/shared/kernel`.                                                                                               |
| **Theme preset** (`ThemeDefinition`) | Declarative manifest in `src/ui/themes/presets/` specifying color tokens, `colorScheme`, optional typography, shape radii, and optional artwork backdrop.                       |
| **Color scheme**                     | Browser polarity (`"light" \| "dark" \| "light dark"`) that drives `<meta name="color-scheme">`, native form controls, scrollbars, and Tailwind `dark:` variants.               |
| **Backdrop**                         | Fixed viewport layer (`z-index: -1`) rendering cached official WPN key art or Scryfall `art_crop` beneath a theme-defined scrim gradient.                                       |
| **Surface panel**                    | Translucent or solid container styling (`--panel-bg`, `--panel-blur`, `--card-bg`, `--header-bg`) that keeps text readable over artwork while remaining a no-op on flat themes. |
| **Palette-only mode**                | User preference (`showThemeBackdrop: false`) that keeps a plane's colors, fonts, and shapes while hiding its background image.                                                  |

## 3. Domain model

### 3.1 Shared kernel types (`src/shared/kernel/theme.ts`)

Lives in `@/shared/kernel` so both `src/modules/social/domain` and `src/ui/themes` can import it without violating `eslint-plugin-boundaries` (ADR 0009):

```ts
export const THEME_IDS = [
  "system",
  "light",
  "dark",
  "catppuccin-latte",
  "catppuccin-mocha",
  "bloomburrow",
  "innistrad",
  "kamigawa",
  "new-capenna",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = "system";

export type ThemePreference = Readonly<{
  themeId: ThemeId;
  showBackdrop: boolean;
}>;

export type ThemeError = { kind: "UnknownTheme"; themeId: string };

export function checkThemeId(raw: string): Result<ThemeId, ThemeError>;
```

### 3.2 Curated theme manifest (`src/ui/themes/types.ts`)

Adding a new theme requires creating one preset file in `src/ui/themes/presets/` and adding its ID to `THEME_IDS` and `THEME_REGISTRY` (`Record<ThemeId, ThemeDefinition>`). TypeScript enforces exhaustiveness at compile time.

```ts
export type ThemeCategory = "default" | "palette" | "plane";
export type ThemeColorScheme = "light" | "dark" | "light dark";

export type ThemeArtworkSource =
  | { kind: "wpn-key-art"; setCode: string }
  | { kind: "scryfall-art-crop"; setCode: string; collectorNumber: string }
  | { kind: "static"; path: string };

export type ThemeBackdrop = Readonly<{
  source: ThemeArtworkSource;
  /** CSS background-position, e.g. "center 20%" so key subjects stay above the fold. */
  focalPoint: string;
  /** CSS gradient scrim layered over the image to blend edges into --canvas-bg. */
  scrim: string;
  opacity?: number;
  credit?: string;
}>;

export type ThemeTypography = Readonly<{
  /** CSS font-family variable for headings (e.g. var(--font-display-serif)). */
  displayFont: string;
  /** Optional body font override (defaults to var(--font-geist-sans)). */
  bodyFont?: string;
  /** Optional heading letter-spacing adjustment. */
  headingTracking?: string;
}>;

export type ThemeShape = Readonly<{
  /** Mapped to --radius-card (default 0.5rem). */
  cardRadius: string;
  /** Mapped to --radius-control (default 0.375rem). */
  controlRadius: string;
  /** Optional subtle elevation or border glow on cards/panels. */
  cardShadow?: string;
}>;

export type ThemeTokens = Readonly<{
  background: string;
  foreground: string;
  muted: string;
  surface: string;
  surfaceRaised: string;
  field: string;
  borderSubtle: string;
  line: string;
  accent: string;
  accentHover: string;
  accentForeground: string;
  danger: string;
  dangerHover: string;
  dangerForeground: string;
  dangerText: string;
  dangerSoft: string;
  dangerLine: string;
  dangerInk: string;
  successText: string;
  successSoft: string;
  successLine: string;
  successInk: string;
  warningText: string;
  warningSoft: string;
  warningLine: string;
  warningInk: string;
  focusRing: string;
  /* Steam-profile surface/chrome tokens (no-op on flat themes). */
  canvasBg: string;
  panelBg: string;
  panelBlur: string;
  cardBg: string;
  headerBg: string;
}>;

export type ThemeDefinition = Readonly<{
  id: ThemeId;
  name: string;
  category: ThemeCategory;
  description: string;
  colorScheme: ThemeColorScheme;
  /** Keyrune set code shown in the theme picker for plane themes. */
  setCode?: string;
  /** Three hex preview swatches rendered in the picker card. */
  swatches: readonly [string, string, string];
  /** Present on explicit themes; omitted on "system" which uses :root + OS media query. */
  tokens?: ThemeTokens;
  typography?: ThemeTypography;
  shape?: ThemeShape;
  backdrop?: ThemeBackdrop;
}>;
```

### 3.3 Starter v1 roster (9 themes)

| ID                 | Category  | Scheme       | Typography & Shape                                                             | Artwork Source                                    |
| ------------------ | --------- | ------------ | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| `system`           | `default` | `light dark` | Geist Sans, `8px` / `6px`                                                      | None                                              |
| `light`            | `default` | `light`      | Geist Sans, `8px` / `6px`                                                      | None                                              |
| `dark`             | `default` | `dark`       | Geist Sans, `8px` / `6px`                                                      | None                                              |
| `catppuccin-latte` | `palette` | `light`      | Geist Sans, `10px` / `8px`                                                     | None                                              |
| `catppuccin-mocha` | `palette` | `dark`       | Geist Sans, `10px` / `8px`                                                     | None                                              |
| `bloomburrow`      | `plane`   | `light`      | Editorial serif headings (`Fraunces` / `Newsreader`), soft `12px` / `8px`      | WPN `blb` Key Art                                 |
| `innistrad`        | `plane`   | `dark`       | Classic gothic serif headings (`Cinzel`), crisp `4px` / `4px`                  | WPN `inr` Key Art (fallback: Scryfall `art_crop`) |
| `kamigawa`         | `plane`   | `dark`       | Sleek geometric display headings (`Space Grotesk`), sharp `4px` / `3px`        | WPN `neo` Key Art (fallback: Scryfall `art_crop`) |
| `new-capenna`      | `plane`   | `dark`       | 1920s Art Deco display headings (`Poiret One` / `Cinzel`), sharp `2px` / `2px` | WPN `snc` Key Art (fallback: Scryfall `art_crop`) |

**Wave 2 (1-file drop-ins after v1):** `ravnica` (`rvr`, light), `ixalan` (`lci`, dark), `theros` (`thb`, light or starry dark), and `nauctis` (once the upcoming set and its WPN key art sync).

## 4. Invariants

1. **Exhaustive registry:** Every `ThemeId` in `THEME_IDS` has an entry in `THEME_REGISTRY`; unknown IDs in cookies or DB rows fall back safely to `system` without throwing.
2. **WCAG AA contrast on every theme:** For every preset with explicit `tokens`, normal-text pairs (`foreground` on `background`/`surface`/`surfaceRaised`/`field`, `muted` on `background`/`surface`, `accentForeground` on `accent`, `dangerInk` on `dangerSoft`, `successInk` on `successSoft`, `warningInk` on `warningSoft`) MUST meet contrast ratio $\ge 4.5:1$, and UI focus/accent pairs meet $\ge 3:1$. Enforced by unit test.
3. **Zero visual regression for default users:** With `themeId = "system"`, `--panel-bg` is `transparent`, `--panel-blur` is `0px`, `--card-bg` is `transparent`, `--radius-card` is `0.5rem`, `--radius-control` is `0.375rem`, and no backdrop element is mounted.
4. **No external image fetches from the browser (ADR 0007):** Backdrop URLs resolve exclusively to local `/api/artwork/...`, `/api/images/.../artCrop/front`, or `/themes/...` paths.
5. **Graceful missing-artwork fallback:** If a plane's WPN key art or Scryfall printing is not synced in the local database, the theme still renders its full palette, typography, shape, and scrim without broken images or errors.
6. **Accessibility overrides win:** Under `@media (forced-colors: active)`, backdrop artwork and custom scrims are hidden. Under `@media (prefers-reduced-transparency: reduce)`, translucent panel/card tokens collapse to opaque `--background` / `--surface`.
7. **No JS required for base scheme:** `:root` keeps `color-scheme: light dark` as its base declaration; server-rendered `data-theme` and `data-color-scheme` attributes style the document on first byte with zero FOUC.
8. **Tailwind `dark:` follows active theme polarity:** Custom `@custom-variant dark` activates when `[data-color-scheme="dark"]` is present, or when no explicit light scheme is pinned and OS `prefers-color-scheme: dark` matches.

## 5. Use cases

| Use case                | Actor / authz                   | Input                       | Output                                                                      | Errors (`kind`)        | Transaction?                   |
| ----------------------- | ------------------------------- | --------------------------- | --------------------------------------------------------------------------- | ---------------------- | ------------------------------ |
| `updateThemePreference` | Signed-in `Actor`               | `{ themeId, showBackdrop }` | `Result<ThemePreference, ThemeError>`                                       | `UnknownTheme`         | Yes (upsert `player_profiles`) |
| `getThemePreference`    | Signed-in `Actor` (or `null`)   | `userId`                    | `ThemePreference` (defaults to `{ themeId: "system", showBackdrop: true }`) | none                   | No (read query)                |
| `resolveThemeBackdrop`  | Server layout (`Actor \| null`) | `ThemeDefinition`           | `ResolvedBackdrop \| null` (`{ url, focalPoint, scrim, opacity, credit }`)  | none (graceful `null`) | No (cached read)               |

## 6. Ports & UI/CSS architecture

### 6.1 Catalog & backdrop resolution

- **Expose `artCrop` on `/api/images/[printingId]/[size]/[face]`:** Add `"artCrop"` to the allowed `size` union in [route.ts](file:///home/jack/Projects/tcg-virtual-library/src/app/api/images/[printingId]/[size]/[face]/route.ts). It already routes through `catalog.imageFor(..., size: "artCrop")` and the existing `<IMAGE_CACHE_DIR>/artCrop/` disk cache.
- **Backdrop lookup query (`src/modules/catalog/cards/queries/`):** A small cached query that, given a `ThemeArtworkSource`, resolves:
  - `wpn-key-art`: latest downloaded `artwork_files` `imageId` for `wpn_pages.setCode = setCode` (`size = "large"` → `/api/artwork/${imageId}/large`).
  - `scryfall-art-crop`: `printings.id` for `(setCode, collectorNumber)` → `/api/images/${printingId}/artCrop/front`.
  - If WPN key art is not yet synced for a plane, a preset may declare an optional `fallbackSource` (e.g., an iconic card's `scryfall-art-crop`).

### 6.2 CSS tokens, Tailwind v4 & UI primitives

- **Tailwind v4 `@custom-variant dark`** in [globals.css](file:///home/jack/Projects/tcg-virtual-library/src/app/globals.css):
  - Matches `[data-color-scheme="dark"]` (and descendants), or OS `@media (prefers-color-scheme: dark)` when `:root` does not have `[data-color-scheme="light"]`.
  - Automatically fixes all 82 existing `dark:` utility classes across 31 files when an OS-light user picks a dark theme (or vice versa).
- **Theme CSS variables:** Generated or declared per `[data-theme="<id>"]` selector in `src/app/themes.css` (imported by `globals.css`) so themes stay pure CSS with zero runtime style-tag injection on client navigations.
- **Native UI integration:**
  - Sync `<meta name="color-scheme">` and `:root { color-scheme: ... }` for `light` / `dark` / `light dark`.
  - Set `accent-color: var(--accent)` on `html`.
  - Set `scrollbar-color` on `:root` without transitioning it (avoids WebKit flicker).
- **Shape & typography tokens in `@theme inline`:**
  - `--radius-card: var(--theme-radius-card, 0.5rem)`
  - `--radius-control: var(--theme-radius-control, 0.375rem)`
  - `--font-display: var(--theme-font-display, var(--font-geist-sans))`
  - Update [page.tsx](file:///home/jack/Projects/tcg-virtual-library/src/ui/page.tsx), [card.tsx](file:///home/jack/Projects/tcg-virtual-library/src/ui/card.tsx), [button.tsx](file:///home/jack/Projects/tcg-virtual-library/src/ui/button.tsx), [field.tsx](file:///home/jack/Projects/tcg-virtual-library/src/ui/field.tsx), [dialog.tsx](file:///home/jack/Projects/tcg-virtual-library/src/ui/dialog.tsx), and [site-header.tsx](file:///home/jack/Projects/tcg-virtual-library/src/app/site-header.tsx) to use `bg-panel`, `bg-card`, `bg-header`, `rounded-card`, `rounded-control`, and `font-display` on headings.
- **Backdrop component (`src/app/_components/theme-backdrop.tsx`):**
  - Renders a single fixed `aria-hidden="true"` `pointer-events-none` layer using CSS `background-image: var(--theme-backdrop-image)` (respects the ESLint rule banning raw `<img>` in `src/app` and `src/ui`) plus a scrim overlay `div`.

### 6.3 Cookie mirror & SSR wiring

- Cookie name: `pl_theme`, format `<themeId>:<1|0>` (e.g. `bloomburrow:1`), `Path=/`, `SameSite=Lax`, `Max-Age=31536000`.
- [layout.tsx](file:///home/jack/Projects/tcg-virtual-library/src/app/layout.tsx) reads `pl_theme` on the server (falling back to DB lookup on first request when signed in without the cookie, and `system:1` for guests), resolves the backdrop URL if `showBackdrop` is true, and renders `data-theme`, `data-color-scheme`, and `--theme-backdrop-image` directly in the initial HTML.
- Updating the theme in `/account/appearance` writes to `player_profiles`, updates `pl_theme`, and calls `revalidatePath("/", "layout")` so the whole shell updates immediately.

## 7. Persistence

Add two columns to `player_profiles` in [schema.ts](file:///home/jack/Projects/tcg-virtual-library/src/modules/social/infrastructure/schema.ts):

- `theme_id`: `text("theme_id").notNull().default("system")`
- `show_theme_backdrop`: `boolean("show_theme_backdrop").notNull().default(true)`

**Migration notes:** Additive columns with safe defaults — zero downtime, no backfill needed. Deliberately omit a DB `CHECK` constraint on the exact list of `theme_id` values so adding Wave 2 themes (Ravnica, Ixalan, Theros, Nauctis) never requires a database migration; validation happens in `checkThemeId` in the domain layer and unknown IDs safely fall back to `system`.

## 8. Read models (queries) & UI screens

- **`/account/appearance`** (linked from `/account` hub and `/account/profile`):
  - Grouped into **Default**, **Color palettes**, and **MTG planes** sections.
  - Each theme card shows its name, Keyrune set icon (for planes), 3 color swatches, a mini typography/corner preview, and active state (`aria-pressed` / radio group).
  - **"Show background artwork"** toggle (palette-only switch) with helper note explaining that colors, fonts, and shapes stay active when disabled.
  - Attribution line showing the active backdrop's set/artwork credit when a plane backdrop is enabled.

## 9. Patterns applied

- **Closed discriminated unions & exhaustive registries** (`patterns.md`): `ThemeArtworkSource` discriminated union and `Record<ThemeId, ThemeDefinition>` guarantee compile-time completeness.
- **Result types (ADR 0003):** `checkThemeId` returns `Result<ThemeId, ThemeError>`.
- **External data ACL (ADR 0007) & WPN imagery (ADR 0015):** Reuses existing local disk caches for WPN key art and Scryfall `art_crop`.
- **Client-safe module API (ADR 0016):** Pure theme definitions live in `src/ui/themes/` and `@/shared/kernel`; server-only DB/backdrop resolution stays in `src/modules/` and `src/app/`.

## 10. Test plan

- **Domain & registry unit tests (`vitest`):**
  - `checkThemeId` accepts every `THEME_IDS` entry and rejects unknown IDs with `UnknownTheme`.
  - Cookie parser handles valid values, malformed strings, and retired/unknown theme IDs by falling back to `{ themeId: "system", showBackdrop: true }`.
  - **WCAG AA contrast suite:** computes relative luminance and asserts $\ge 4.5:1$ (normal text) and $\ge 3:1$ (UI/focus) for every token pair across every registered theme.
- **Use-case & integration tests (`pnpm test:int`):**
  - `updateThemePreference` persists `theme_id` and `show_theme_backdrop` on `player_profiles` and round-trips through `getThemePreference`.
  - `resolveThemeBackdrop` resolves WPN key art, falls back to `scryfall-art-crop`, and returns `null` cleanly when neither is in the DB.
- **E2E touchpoints (`pnpm test:e2e`):**
  - Switching themes on `/account/appearance` updates `<html data-theme>` and `<html data-color-scheme>`, persists across reload without FOUC, and toggles backdrop visibility.
  - Run `tests/e2e/15-accessibility.spec.ts` checks under default, a dark palette (`catppuccin-mocha`), and a plane theme (`bloomburrow` / `innistrad`).

## 11. Lesson plan (`../proxy-library-lessons`)

Because this phase introduces several reusable TypeScript + CSS + Next.js patterns, it gets a dedicated lesson in `../proxy-library-lessons`:

1. **`as const` tuple unions + `Record<ThemeId, T>` exhaustive registries** (making "add a theme in one file" compiler-enforced).
2. **Tailwind v4 `@custom-variant` & CSS custom-property scoping** (why `[data-theme]` / `[data-color-scheme]` beat JS theme contexts and prepare for subtree scoping).
3. **SSR cookie-mirrored preferences** (zero-FOUC theming in Next.js App Router without an extra DB hit on every route).
4. **Pure WCAG relative-luminance contrast tests** (turning design invariants into automated unit tests).
