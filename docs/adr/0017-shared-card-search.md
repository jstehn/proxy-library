# 0017. One card search language, shared by every module that searches cards

- **Status:** Accepted (design doc 15)
- **Date:** 2026-10-01

## Context

The deck builder had a Scryfall-style search language (design doc 14) in the decks module. Design
doc 15 asks for the same search in the singles store (catalog module) and the collection
(collection module), with more keywords. Module queries may not import another module's code
(ADR 0009), so the catalog and collection couldn't use the decks module's parser. Copying it
three times would let the copies drift. The same was true of reading pasted card lists, which the
store now needs for buying a list.

## Decision

- The language lives in **`src/shared/card-search`**, a shared element like the kernel:
  - `index.ts`, `parse.ts`, `list.ts`: **pure** (text in, a syntax tree or list lines out). Domain
    code, application code, queries and the app (including client components, for quick filters)
    may import it. Lint holds it to the same purity rules as domain code.
  - `sql.ts`: turns a syntax tree into SQL over printings aliased `p`. Only **queries** may import
    it (lint-enforced), so `drizzle-orm` never reaches the browser.
- A **search context** says what the few page-dependent words mean: the player (for `own`), and
  the SQL that answers `is:foil` (sold in foil, this copy is foil, or you own a foil copy).

## Consequences

- One parser, one SQL builder and one set of tests for three search boxes; a new keyword works
  everywhere at once, and the help page lists it once.
- The SQL builder knows table names from more than one module (printings, card sets, price
  snapshots, collection cards). That's the same trade ADR 0006 makes for read queries: reads may
  join across modules; writes stay in each module.
- Changing the language now affects every page, so its tests live next to it and the integration
  tests run one search on all three pages.

## Alternatives considered

- **Keep it in decks and expose it through `decks/index.ts`:** the catalog and collection would
  depend on decks, backwards from how the modules depend on each other.
- **A new "search" module:** a module owns data and use cases; this is a language with no data
  of its own, closer to the kernel.
- **Copies in each module:** three places to fix every bug.
