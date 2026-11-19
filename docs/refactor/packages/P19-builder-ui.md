# P19. Break up the deck builder UI

- **Branch:** `refactor/P19-builder-ui` · **Depends on:** P09 · **Parallel with:** waves 3–4,
  except P16 (both touch `stats-panel.tsx`)
- **Audit:** doc 65 F8

## Goal

The builder's state lives in one tested reducer, and each panel is its own component with its own
hooks and actions.

## Touches

`src/app/decks/[id]/builder/` (all): `deck-builder.tsx` (1,459 lines, 35 `useState`/`useEffect`),
`actions.ts`, `deck-list.tsx` (607), `snapshots-panel.tsx`, `primer-panel.tsx`.

## Steps

1. Map the 35 hooks: which state is shared between panels, and which belongs to one panel.
2. Shared state goes into `builder-state.ts`: a `useReducer` with named actions and a pure
   reducer, unit-tested. Panel-only state moves into the panel.
3. One folder per panel (`list/`, `stats/`, `suggestions/`, `snapshots/`, `primer/`, `cuts/`,
   `test-hand/`), each with its component, hooks and an `actions.ts` for its server actions.
4. Check dark mode and phone width with screenshots, and run the builder's Playwright flow.

## Done when

- No file in `builder/` is over 500 lines. The reducer has unit tests. The e2e builder flow passes.

## Handoff

(empty)
