# P05. Capability and binding framework

- **Branch:** `refactor/P05-framework` · **Depends on:** P03, P04 · **Parallel with:** none (P06–P08 build on it)
- **Audit:** doc 65 F2 (the diagram and "the root cause"), principle 4 in section 5
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S1](../dedup-playbook.md#s1) (the shape and the first two rows) · **Lines to remove:** small: the framework adds code; the removal comes in P06–P09

## Goal

Set the pattern the rest of wave 2 follows. Capabilities are typed functions in modules. An LLM
tool is a small binding over them. The transports (`mcp.ts`, `openapi.ts`, `http.ts`) are
generic. Port **two** tools end to end as examples: `list_decks` and `get_account`.

## Touches

`docs/adr/0026-capabilities-and-adapters.md` (new), `src/app/_llm-tools/{binding.ts,registry.ts,mcp.ts,openapi.ts,http.ts,cap-response.ts}`,
new `src/app/_llm-tools/bindings/`, `src/server/core.ts`, `eslint.config.mjs`.

## Steps

1. **ADR 0026**: capabilities live in modules; four adapter kinds (server action, tool binding,
   API route, worker command); what each may contain (parse input, call capabilities, present
   output) and may not (logic, calling another adapter, importing `domain/`, `queries/` or
   `@/shared/db`). Get the user's approval.
2. **`binding.ts`**: `defineBinding({ name, description, scope, input, call, present })`.
   `input` is a Zod schema, usually the capability's own schema extended with `.describe()` text.
   `call(capabilities, actor, input)` returns a `Result`. `present(value)` returns JSON for the
   model. Errors go through the module's `describe…Error` (start with decks in P06).
3. **Transports**: `mcp.ts`, `openapi.ts` and `http.ts` take `BINDINGS` and handle protocol,
   scopes, input checks and the size cap (`cap-response.ts`). They must not import any module.
4. **Two examples**: `list_decks` and `get_account` as capabilities (in `decks` and `accounts`
   `application/`, wired in `core.ts`) plus binding files. Compare with
   `docs/refactor/reference/tools/*.json`.
5. **Lint**: the ADR's rules for `src/app/_llm-tools/bindings/**` and `src/app/**/actions.ts`
   (allow imports only from modules' `index.ts`/`client.ts` and from `src/server`).
6. **One adapter helper:** `action(async ({ actor, capabilities }, input) => …)` in
   `src/server/`, which checks the session, gets the capabilities from the composition root and
   parses the input with the capability's schema. Bindings and routes use the same shape. P06–P09
   move their actions onto it; P09 removes the last `getContainer()` call outside the helper.
7. The old `tools/` files stay until P09. The registry serves bindings first and falls back to
   the old tools for names not ported yet.

## Done when

- ADR 0026 is accepted. Both example tools are served from bindings, and their unit tests (with
  fakes) pass.
- A "how to add a capability and a binding" note is in the ADR, short enough for P06–P09 to follow.

## Handoff

(empty)
