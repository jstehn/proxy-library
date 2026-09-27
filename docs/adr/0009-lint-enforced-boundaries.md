# 0009. Enforce architecture boundaries with lint rules

- **Status:** Proposed
- **Date:** 2026-09-26

## Context

Architectures written only in documents erode one convenient import at a time. The rules in
[overview.md](../architecture/overview.md) and [conventions.md](../architecture/conventions.md)
are mechanical enough to check automatically.

## Decision

`pnpm lint` fails on:

- **Layer violations** (`eslint-plugin-boundaries`): `domain` → only `shared/kernel`.
  `application` → own domain, kernel, other modules' `index.ts`. `infrastructure` → own
  application/domain, `shared/db`, `shared/http`. `app/` → modules' `index.ts`, `server/`, `ui/`.
  Only composition roots import `infrastructure`.
- **Deep imports** into another module (anything but its `index.ts`).
- **Cycles** (`import/no-cycle`).
- **Forbidden globals outside adapters** (`no-restricted-syntax` / `no-restricted-globals`):
  `Math.random`, `Date.now`, `new Date()` without arguments, `process.env` (except in
  `shared/config.ts`), `fetch` (except in `shared/http` and adapters).
- **Framework imports in domain** (`no-restricted-imports`): `next`, `react`, `drizzle-orm`, `zod`,
  `node:*`.
- **Type-safety escapes:** `no-explicit-any`, `no-non-null-assertion`.

Violations that are genuinely justified use an inline `eslint-disable-next-line` **with a reason**.
A recurring need means the rule or the architecture should change (via an ADR).

## Consequences

- ✅ The architecture is self-defending, and reviews focus on design rather than import paths.
- ❌ Lint config complexity. It lives in one file with comments mapping rules to this ADR.
- ❌ Plugin versions must track ESLint 9 flat config, so they're verified at setup time.

## Alternatives considered

- **Convention only:** erodes.
- **dependency-cruiser:** great for graphs and reports and can be added later for visualization,
  but ESLint gives in-editor feedback.
