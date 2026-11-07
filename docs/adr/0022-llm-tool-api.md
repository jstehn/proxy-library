# 0022. Serve LLM tools from one registry, over MCP and OpenAPI, signed in with access tokens

- **Status:** Accepted (design doc 28, approved 2026-11-07)
- **Date:** 2026-11-07

## Context

You want an LLM to help build decks from your real collection, decks and wishlist, and it must
work with almost any LLM, not one vendor's app. Today nothing in the app is reachable by a
program: pages are server components and writes are server actions behind a sign-in cookie.

LLM clients differ. Most now speak the **Model Context Protocol** (MCP) over HTTP; some only start
local stdio servers; some do plain function calling from an **OpenAPI** description and know
nothing of MCP. Some send any header you give them; web connectors at claude.ai and ChatGPT accept
only OAuth. Small local models cope badly with deep or union-typed schemas and often ignore MCP
prompts and resources.

## Decision

- **One tool registry** in the app layer (`src/app/_llm-tools/`): each tool has a name,
  instructions, a Zod input and output schema, a scope and a handler that calls existing queries
  and use cases with the caller's `Actor`. Tools add no business rules.
- **Two thin endpoints over it:** `POST /api/mcp` (MCP Streamable HTTP, stateless, with the
  official TypeScript SDK) and `POST /api/tools/<name>` described by `GET /api/tools/openapi.json`
  (OpenAPI 3.1 generated from the same Zod schemas). Clients that only run stdio use the
  `mcp-remote` bridge.
- **Personal access tokens** (`Authorization: Bearer pl_…`), created and revoked on the Account
  page, stored as SHA-256 hashes, with scopes `read`, `decks:write`, `wishlist:write`. OAuth 2.1 is
  left for a later phase.
- **Nothing that moves money or cards** is a tool.
- **Compatibility rules** for every tool: a flat input object, no `oneOf`/`anyOf`/`allOf`,
  enums for choices, every field described, bounded results, and everything the model needs in
  the tool description and result (MCP instructions, resources and prompts only repeat it).

## Consequences

- Any MCP client or function-calling setup can use the app; adding a tool means one registry
  entry, and both endpoints get it.
- The registry tests (schema rules, same tools on both endpoints, the fixed list of write tools)
  must be kept passing; a tool that needs a union input must be reshaped instead.
- Tokens are a second way to sign in, so `actorFromToken` must apply the same checks as
  `getActor` (active player, no pending password change).
- Web connectors that need OAuth (claude.ai, ChatGPT web) don't work until the OAuth phase.
- A new dependency, `@modelcontextprotocol/sdk`, pinned to an exact version.

## Alternatives considered

- **MCP only:** covers most clients, but leaves out function calling without MCP, and the OpenAPI
  endpoint is cheap once the registry exists.
- **A local stdio MCP server reading the database:** works for one machine only, bypasses the
  app's permission checks, and needs database credentials on the client.
- **A general REST API (resources, not tools):** more to design and document, and an LLM still
  needs task-shaped operations like `search_for_deck` on top.
- **OAuth first:** needed only for web connectors, and several times the work of tokens.
- **Better Auth's API-key plugin:** not in the installed version's plugin set, and identity is all
  ADR 0012 lets Better Auth own; scopes and token lists are app rules.
