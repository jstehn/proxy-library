# 0016. A browser-safe public API per module (`client.ts`)

- **Status:** Accepted (design doc 14)
- **Date:** 2026-09-30

## Context

The deck builder recomputes statistics in the browser the moment a card is added (design doc 14,
section 2.5). The statistics are pure domain code in the decks module, but the app may only import
a module's `index.ts`, which also exports database queries. Importing it into a client component
would send database code to the browser, or fail to build.

## Decision

- A module may offer a second public file, **`client.ts`**, that re-exports **only its own pure
  domain code** (no application, queries, infrastructure or testing).
- The app may import `client.ts` (in client components) as well as `index.ts`.
- Lint enforces it (`eslint.config.mjs`): `client.ts` importing anything but its domain fails.

## Consequences

- Pure rules (deck statistics, the search parser) run in the browser and on the server from one
  source.
- A module's public surface now has two files; `index.ts` stays the default for server code.
