# Coding conventions

Rules marked 🔒 are enforced by tooling (lint, typecheck, or tests). The rest are for review.

## Structure

- 🔒 Feature code lives in `src/modules/<module>/{domain,application,infrastructure,queries,testing}`.
- 🔒 Other modules and `src/app/` import a module **only via its `index.ts`**.
- 🔒 `domain/` imports nothing outside `shared/kernel` (no `drizzle-orm`, `next`, `react`, `zod`,
  or Node built-ins), except **types** from other modules' public `index.ts`, with `import type`
  only (e.g. the pack engine works on the catalog's `BoosterConfig`). Using another module's
  vocabulary is fine; running its code is not.
- 🔒 `testing/` may also import other modules' public `index.ts`, to build sample data.
- 🔒 Only composition roots (`src/server/`, `worker/`) import `*/infrastructure`.
- 🔒 Infrastructure may import its own module's layers, `shared/db`/`shared/http`, other modules'
  `infrastructure/schema.ts` (for foreign keys) and other modules' public `index.ts` (for shared
  types like `Actor`), and nothing else.
- 🔒 No import cycles.
- 🔒 The app composition root (`src/server/container.ts`) starts with `import "server-only"`, so a
  client component can't pull in DB code by accident. (Not in shared code: `server-only` throws
  outside Next.js, which would break the worker and tests.)
- `src/server/core.ts` holds the wiring shared by both composition roots.
- Real adapters for kernel ports that touch the OS (`systemClock`, `randomSeed`) live in
  `src/shared/runtime/`. Only composition roots import them.
- `src/app/` holds routes, layouts, server actions and route-specific components (`_components/`).
  Shared presentational components live in `src/ui/`.

## TypeScript

- 🔒 `strict` on. 🔒 No `any` (`@typescript-eslint/no-explicit-any`). 🔒 No non-null `!`.
- `as` casts only inside smart constructors.
- A branded type gets a **companion object** with the same name that holds its constructor and
  operations: `Cents.of(123)`, `Cents.add(a, b)`, `Cents.format(c)`, `UserId.of(s)`. TypeScript
  keeps types and values in separate namespaces, so `Cents` is both.
- Prefer `type` for unions and data, `interface` for ports (either is fine; be consistent per file).
- Data is **immutable** by default: `readonly` fields, `ReadonlyArray<T>`, no mutating function
  parameters.
- Model alternatives with **discriminated unions** (`kind` field), not optional-field soup.
- Every `switch` over a union ends with `default: return assertNever(x)`.
- `const` by default, `let` when reassigning, never `var`.
- Named exports only. `export default` is allowed only where Next.js requires it (`page.tsx`,
  `layout.tsx`, …).

## Naming

| Thing               | Convention                             | Example                                                                                                                  |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Files               | kebab-case                             | `buy-sealed.ts`, `drizzle-ledger-repo.ts`                                                                                |
| Types / interfaces  | PascalCase, no `I` prefix              | `LedgerRepo`, `BoosterConfig`                                                                                            |
| Functions           | camelCase, verb first                  | `accrueAllowance`, `generatePack`                                                                                        |
| Factories           | `make` + thing                         | `makeWalletService`, `makeBuySealed`                                                                                     |
| Adapters            | tech + port                            | `drizzleLedgerRepo`, `httpScryfallGateway`                                                                               |
| Fakes               | `inMemory` / `fixed` / `seeded` + port | `inMemoryLedgerRepo`, `fixedClock`, `seededRng`                                                                          |
| Error kinds         | PascalCase string literal              | `{ kind: "InsufficientFunds" }`                                                                                          |
| Booleans            | `is`/`has`/`can` prefix                | `canSelfFund`, `isFoil`                                                                                                  |
| DB tables / columns | snake_case, plural tables              | `ledger_entries.amount_cents`                                                                                            |
| Money variables     | include the unit                       | `priceCents`, or typed `Cents`                                                                                           |
| Everything          | **full words, no abbreviations**       | `unitOfWork`, `dependencies`, `transaction`, not `uow`, `deps`, `tx`. Only universal ones are allowed: `db`, `id`, `url` |

## Readability: the code is also teaching material

This codebase is read by someone learning TypeScript. Prefer the version a newcomer can follow
over the clever one.

- **Name types instead of nesting them.** Don't write an object type inside another object type
  inside a parameter list. Give each level a name (`CheckHealthDependencies`,
  `HealthCheckServices`) and use the name.
- **Factories follow one shape:**

  ```ts
  export type CheckHealthDependencies = {
    unitOfWork: UnitOfWork<HealthCheckServices>;
    clock: Clock;
  };

  export function makeCheckHealth(dependencies: CheckHealthDependencies) {
    const { unitOfWork, clock } = dependencies; // 1. unpack what was passed in

    async function checkHealth(): Promise<Result<HealthReport, HealthError>> {
      // 2. a *named* function that does the work
    }

    return checkHealth; // 3. hand it back by name
  }
  ```

  The returned function is declared with `function name() {}`, not as an anonymous
  `return async () => …`, so it has a name in the code, in stack traces and in the editor.

- **Use intermediate variables.** `const report: HealthReport = {…}; return ok(report);` is
  easier to read than one long nested expression.
- **Name the types of a transaction that can fail in more than one way:**
  `unitOfWork.run<Player, SetAdminError>(async (services) => …)`. TypeScript infers the error type
  from the first `err(...)` it sees and then rejects the others, so spell it out. It also tells
  the reader what the transaction can produce.
- **Keep arrow functions for short callbacks**, such as `items.map((item) => item.id)`.
- **Explain the why.** Comment the reason for anything surprising, and give every exported
  function a one-line TSDoc saying what it's for.

## Functions and use cases

- A use case = **one exported factory** returning **one function**, in its own file named after the
  action (`application/buy-sealed.ts`). Related small operations may be grouped into a service
  object (`makeWalletService`).
- Use cases take an `Actor` (who is acting) as the first argument whenever authorization matters.
  **Authorization is checked in the use case**, not only in the UI (`proxy.ts` gating is for UX).
- Use cases return `Promise<Result<T, E>>` for expected failures and throw only for defects.
- Keep functions short and at one level of abstraction. If it needs a comment to separate its
  "sections", extract them.
- No boolean flag parameters. Use an options object with named fields, or two functions.
- **Formats are a table, not a comparison.** How formats differ lives only in
  `decks/core/domain/format-rules.ts` (`FORMAT_RULES`, `satisfies Record<Format, FormatRuleSet>`). Ask
  `formatRules(format).hasCommandZone` (browser code: from `@/modules/decks/client`), never
  `format === "commander"`; lint forbids the comparison. A new question is a new field, which will not
  compile until every format answers it.

## Data and I/O

- 🔒 Only `shared/config/` reads `process.env`.
- 🔒 Only adapters call `fetch`, `Date.now`/`new Date()`, `Math.random`, `fs`.
- All external JSON is Zod-parsed in the adapter and mapped to domain types before it goes further.
- Money is `Cents` (branded integer). Rates are basis points (`5000` = 50%). Rounding happens in
  exactly one kernel function (`applyRate(cents, bps)`), and its rule is fixed in the wallet design
  doc, so no other code rounds money.
- Timestamps are `Date` in domain code and `timestamptz` in Postgres. View models use ISO strings.
- Migrations are generated by drizzle-kit, committed, and never edited after merge.
- 🔒 A regex over a card's rules text lives in a recognizer (`catalog/domain/features/recognizers/`), with a
  fixture test on real card text; consumers read `catalog.cardFeatures`. `pnpm regex-count` keeps the
  number of regexes in card-rule code from rising (ADR 0027).

## UI

- **Where UI goes.** A route's own UI lives in its `_components/`. UI shared by two or more routes
  lives in `src/ui/<area>/` (or `app/_components` for card UI). `src/ui` holds presentational
  building blocks only (`Button`, `Card`, `Field`, `Page`, `PageMessage`, `PageSkeleton`, ...): no
  state machines, no sounds, no query logic. Logic that one route uses sits beside that route.
- **A page** calls `readPage()`, parses its params, reads through `reads` and capabilities, and
  composes components. It holds no rules and no local component over about 60 lines. A component
  file over 300 lines in `src/app` is a lint warning (the 500-line limit stays the gate).
- **Page states.** `error.tsx`, `not-found.tsx` and `loading.tsx` at the root; `loading.tsx` in the
  big sections. The error page never shows the message or a stack: the player gets a plain
  sentence, "Try again" and a way home.
- **Every action is written one way.** `formAction(schema, handler, options)` for a form that shows
  a message; `formRedirect(schema, handler, options)` for a plain `<form action>` that goes
  somewhere (the handler returns the path); `formVoid` for a silent one. A form with its own state
  (it keeps typed values, shows a secret once) reads its fields with `parseForm(schema, formData)`.
  No file in `src/app` calls `formData.get`. Actions return a `Result`, never a view model; a read
  is a read, not an action.
- **`paths.ts` per area** owns the area's paths and what to refresh (`revalidateDeck(deckId)`,
  `revalidateTrades()`); no `revalidatePath` outside a `paths.ts`. `app/paths.ts` has
  `revalidateHeader()` for the layout.

## Accessibility

- **Focus.** One `:focus-visible` rule in `globals.css` draws the ring (the `--focus-ring` token,
  light and dark). Don't write `focus:` or `focus-visible:` classes on a component; the only
  exceptions are the skip link (it reveals itself on focus) and `focus:outline-none` on a
  programmatic focus target (`tabIndex={-1}`).
- **Images.** Use `CardImage` (`@/ui/card-image`), never a raw `<img>` (lint enforces it). `alt`
  is required: the card's name, or `decorative` when the text beside the image already says it.
  Give `width` and `height` or an aspect-ratio class so the page doesn't jump. It stays a plain
  `<img>` because our own image cache already serves resized WebP.
- **Dialogs.** `Dialog` (`@/ui/dialog`) wraps the native `<dialog>`: the browser traps focus and
  closes it on Escape, and `Dialog` returns focus to the opener. Don't add a dialog library.
- **Destructive actions** (delete, revoke, reset, sell, decline, cancel) use `ConfirmButton`
  (`@/ui/confirm-button`), which asks in a dialog and submits its form only after "Confirm". The
  two typed-word confirmations (start over, reset a player) stay: typing is stricter. Reversible
  actions (rename, add to a wishlist) don't ask.
- **Names.** Every icon-only button has an `aria-label`; every field has a label.

## Comments and docs

- Comments explain **why**, not what. Public functions in `index.ts` get a one-line TSDoc.
- A non-obvious decision gets an ADR, not a long comment.
- When a phase that teaches something new is finished, its lesson (`lessons/NN-*.md`) is written
  or updated (ADR 0023).

## Git

- Small commits with imperative subject lines. At least one commit at the end of each phase.
- Each commit passes `pnpm check` (typecheck + lint + cycles + format + unit tests, run in parallel
  and cached; `rm -rf node_modules/.cache` forces a full run).
