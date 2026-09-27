# 0006. Serve reads through query functions, not repositories

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Screens need filtered, sorted, paginated, joined and aggregated data: the collection grid with
prices, store listings, profile stats, the activity feed. Repositories are designed around
consistent writes to one aggregate. Bending them into reporting tools causes N+1 queries and
bloated interfaces.

## Decision

- Each module has `queries/`: plain functions `(db, params) => Promise<View>` that run one
  purpose-built SQL query (Drizzle query builder or `sql` template) and return **plain,
  serializable view models**.
- Queries **never write** and hold no business rules beyond presentation (sorting, formatting).
- Server Components call queries directly. Queries may join across module tables. The rule is
  that only the owning module **writes** its tables.

## Consequences

- ✅ Fast, simple screens, and SQL skills apply directly.
- ✅ Write-side repositories stay small and aggregate-focused.
- ❌ Queries couple to table shapes across modules, which is acceptable because reads are cheap to
  change and are covered by integration tests.

## Alternatives considered

- **Everything through repositories/use cases:** N+1s and ceremony for zero safety gain on reads.
- **Separate read database/projections:** over-engineering at this scale.
