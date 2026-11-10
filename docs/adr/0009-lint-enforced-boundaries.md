# 0009. Enforce architecture boundaries with lint rules

- **Status:** Accepted
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
- **Cycles** (`pnpm lint:cycles`, part of `pnpm check`; see the note below).
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

## Implementation note (2026-11-10): cycles moved out of ESLint

`import/no-cycle` had grown to 195 of the 212 seconds ESLint took, and so most of every
`pnpm check` (about 4 minutes). Its cost is in building the import graph for every file, so
neither `ignoreExternal` nor `maxDepth: 2` made it faster. Cycles are now found by
`scripts/check-cycles.ts` (`pnpm lint:cycles`, run by `pnpm check`): it reads each file of the
tsconfig project once with the TypeScript compiler, resolves imports as tsconfig does (`@/…`
included), and searches the graph once, in about 2 seconds for 610 files. Like the rule, it
ignores packages and type-only imports (`import type`, or every name marked `type`), which are
erased when compiled and can't loop at runtime. The rule is off in `eslint.config.mjs`.
