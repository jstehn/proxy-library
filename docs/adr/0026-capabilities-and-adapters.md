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
   defects throw). Each module wires its own in `src/modules/<module>/wiring.ts`
   (`wireDeckCapabilities(dependencies)`), which may use its own `queries/`, `application/` and
   `infrastructure/` files. `src/server/capabilities.ts` joins the results and adds the few that
   read across modules, and they reach the app as `core.capabilities`. Only `src/server/**` and
   `worker/**` may import a `wiring.ts` (lint). A reader that belongs to another module is passed
   in as a port, or imported through that module's `index.ts`.
2. **Five adapter kinds** call capabilities and nothing else: a server action
   (`src/app/**/actions.ts`), a page (`page.tsx`, `layout.tsx`), an LLM tool binding
   (`src/app/_llm-tools/bindings/`), an API route, and a worker command. Each may **parse its input, call capabilities, and present the output**.
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
   `{ actor, capabilities }`. Pages and routes use its twin, `readPage()`
   (`src/server/page-instance.ts`; `readPage({ allowVisitors: true })` allows a visitor, with
   `actor: null`). P09b–P09d move the callers onto them (P06–P09 built the capabilities and moved
   only the tool bindings). A lint rule bans `getContainer` in `src/app`, except a short list of files that
   must keep it, each with a reason (`CONTAINER_ALLOWED`). `readCapabilities()` gives routes that
   sign in some other way (a bearer token) the capabilities without resolving a player.

## How to add a capability and a binding

1. In the module, write `application/<verb-noun>.ts`: `makeVerbNoun(dependencies)` returns an
   `async function (actor, input): Promise<Result<Value, Failure>>`. Test it with fakes.
   Export the factory and its types from the module's `index.ts`.
2. In the module's `wiring.ts`, add `verbNoun: makeVerbNoun({ ... })`. (A capability that reads
   across modules goes in `src/server/capabilities.ts`, with the other module's reader passed in.)
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

## Change log

- 2026-11-19: wiring per module (`wiring.ts`), pages as the fifth adapter (`readPage()`), the
  `getContainer` ratchet, and the callers move in P09b–P09d (milestone 1 review).
- 2026-11-19: P09b to P09d moved every page, route and action onto `readPage()`, `action()` and
  `readCapabilities()`; the list of files not yet moved is gone.

## Reads (design doc 67, proposed)

Proposed in P25; takes effect when the owner approves doc 67. It changes decision 1: reads are not
capabilities.

1. **Reads are each module's typed query functions.** A module exports its public reads as one
   namespace from `queries/index.ts`. Pages, actions and routes call them as `reads.<module>.<query>`;
   `reads` comes from `readPage()`, `action()` and `formAction()`, and is built once in
   `src/server/reads.ts` with a generic `bindDb(db, queries)` (it replaces `withDb` and the 14
   `*Reads` bundles). Capabilities stay for writes and for anything with rules or permissions.
2. **Three kinds of read.** A **player** read takes the signed-in `Actor` and filters by it in SQL;
   it never takes a plain `UserId`. A **shared** read checks visibility in SQL (shared deck, shared
   wishlist, public link token) or shows catalog data to any signed-in player. An **admin** read
   takes an `AdminActor`.
3. **Actors can't be forged.** `Actor` and `AdminActor` are branded types. Only the accounts
   module makes them, and only `src/server/session.ts` makes an `AdminActor`. A visitor's page gets
   `PublicReads`, which holds only the token reads.
4. **Whole services aren't passed through.** Each module's `wiring.ts` exposes a narrow capability
   with only the methods its callers use.
5. **One helper for forms.** `formAction(schema, handler, { describeError })` reads `FormData`,
   checks the session as `action()` does, parses, and turns `Result` errors into the form's message.
6. **Enforced** by a type check on each `queries/index.ts` (no public read takes a `UserId` first),
   the existing adapter lint (no `@/shared/db`, no `queries/` imports in `src/app`), and
   `tests/integration/access-rules.int.test.ts`, one test per row of doc 67's table.

Alternatives considered: reads as capabilities (about 97 forwards and a second signature to keep in
step), a `bindDb` per request (hidden state), and binding the actor into `reads` (hides who a read
is for).
