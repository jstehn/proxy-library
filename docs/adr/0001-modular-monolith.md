# 0001. Structure the app as a modular monolith with hexagonal modules

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

The app has about ten distinct concepts (wallet, catalog, packs, inventory, collection, store,
decks, trades, accounts, activity) with real invariants around money and ownership. It runs on
one home server for a small group. Next.js by default encourages putting logic in route files,
which scatters rules across the UI.

## Decision

- One deployable app (plus a worker entry point), split into **feature modules** under
  `src/modules/<name>/`.
- Each module is layered `domain → application → infrastructure`, with `queries/` for reads and a
  single public `index.ts`.
- Modules form an **acyclic** dependency graph (see [overview](../architecture/overview.md)).
- `src/app/` (Next.js) is a thin delivery layer: controllers and views only.

## Consequences

- ✅ Each concept has one home, and rules are testable without Next.js or Postgres.
- ✅ Modules could be extracted later, though we don't expect to need that.
- ❌ More folders and files than a "put it in the route" app, and some indirection to learn.
- ❌ Cross-module operations need a coordination mechanism ([0005](0005-unit-of-work.md)).

## Alternatives considered

- **Layer-first folders** (`/services`, `/repositories`, `/components`): a feature is scattered
  across the tree, and coupling is invisible.
- **Microservices:** distributed transactions for a hobby app. No.
- **Logic in Next.js routes/server actions:** fastest start, untestable rules, and it rots.
