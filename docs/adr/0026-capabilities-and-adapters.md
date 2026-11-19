# 0026. Put capabilities in modules; keep adapters thin

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

The doc 65 audit (F2) found the same logic written several times: a server action, an LLM tool
and a page each fetched, checked and shaped the same data in their own way. The LLM tools
(`src/app/_llm-tools/tools/`) held queries, rules and formatting, so a fix in one place missed the
others, and the transports (`mcp.ts`, `openapi.ts`, `http.ts`) were tied to that code.

## Decision

1. **Capabilities live in modules.** A capability is a typed function in a module's
   `application/` folder, built by a factory from its dependencies (`makeListDecks(...)`), taking
   the actor and an input and returning a `Result` (expected failures are `{ kind }` unions;
   defects throw). Capabilities are wired once, in `src/server/capabilities.ts`, and reach the app
   as `core.capabilities`. A reader that belongs to another module is passed in as a port.
2. **Four adapter kinds** call capabilities and nothing else: a server action
   (`src/app/**/actions.ts`), an LLM tool binding (`src/app/_llm-tools/bindings/`), an API route,
   and a worker command. Each may **parse its input, call capabilities, and present the output**.
   Each may **not** hold business logic, call another adapter, or import a module's `domain/`,
   `queries/`, `application/` or `infrastructure/` files, `@/shared/db` or `card-search/sql`. They
   import a module only through its `index.ts` or `client.ts`. Lint enforces this
   (`eslint.config.mjs`, "Adapters stay thin").
3. **A binding** is `defineBinding({ name, title, description, scope, readOnly, input, call,
present, describeError })`. `input` is a flat Zod object. `call(capabilities, actor, input)`
   returns a `Result`. `present(value, { actor, scopes, input })` returns the JSON for the model.
   `describeError(error)` turns a failure into a sentence (from the module's `describe…Error`).
4. **The transports are generic.** `mcp.ts`, `openapi.ts` and `http.ts` serve every tool in the
   registry: protocol, scopes, input checks and the response size cap. The registry lists
   `BINDINGS` first and falls back to the old tools for names not yet ported (until P09).
5. **One helper for actions**: `action(schema, handler)` (`src/server/action-instance.ts`) checks
   the session, parses the input with the capability's schema, and gives the handler
   `{ actor, capabilities }`. P06–P09 move the actions onto it.

## How to add a capability and a binding

1. In the module, write `application/<verb-noun>.ts`: `makeVerbNoun(dependencies)` returns an
   `async function (actor, input): Promise<Result<Value, Failure>>`. Test it with fakes.
   Export the factory and its types from the module's `index.ts`.
2. In `src/server/capabilities.ts`, add `verbNoun: makeVerbNoun({ ... })`, passing readers from
   other modules as ports.
3. For an LLM tool, add `src/app/_llm-tools/bindings/<verb-noun>.ts` with `defineBinding`, and
   add it to `bindings/index.ts`. Delete the old tool of the same name from `tools/`.
4. For a server action, write `action(Schema, async ({ actor, capabilities }, input) => ...)`.
5. Compare the tool's output with `docs/refactor/reference/tools/<name>.json`.

## Consequences

- One implementation per behaviour; a fix lands everywhere. A new transport is a new adapter.
- A new tool is a short binding file plus a capability, not a controller with queries in it.
- The wiring file grows by a line per capability; ports add some code where a capability needs
  another module's reader.
- During the move there are two ways to write a tool. P09 deletes the old one.

## Alternatives considered

- **Keep tools as controllers over queries.** Simple, but it is how the duplication happened.
- **Have capabilities import other modules' queries.** Breaks the module boundaries (ADR 0009).
- **A generic command bus.** More machinery than a typed function per capability.
