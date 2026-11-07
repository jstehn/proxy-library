# Lesson 28: Tools for a model, tokens for a door

- **Phase:** 28 (an API any LLM can use to read your collection and help build decks: MCP and
  OpenAPI endpoints, personal access tokens, a synergy search and a deck analysis)
- **Prerequisites:** [Lesson 02](02-accounts-and-forms.md) (sessions and password hashing),
  [Lesson 14](14-a-search-language-and-paper.md) (the search language),
  [Lesson 15](15-one-language-many-pages.md) (untrusted regular expressions),
  [Lesson 20](20-suggesting-cards.md) (filter in SQL, rank in TypeScript)
- **Time:** 1½ hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Describe what an **LLM tool** is and what the **Model Context Protocol** sends over the wire
   (JSON-RPC: `tools/list`, `tools/call`).
2. Issue **bearer tokens** safely: high-entropy secrets, stored only as a hash, checked the same
   way whatever goes wrong.
3. Use one **Zod schema as a contract**: it checks input at run time, gives TypeScript its type,
   and becomes the JSON Schema a model reads, and know why some schema shapes confuse models.
4. Serve one list of tools through **two adapters** (MCP and plain HTTP with OpenAPI) and test
   that they agree.
5. Write a tool **for a model to read**: instructions in the description, bounded results, and
   expected failures answered with a sentence that says what to do next.
6. Spot **regular-expression dialect** differences (`\b` in JavaScript vs Postgres) and escape
   text before putting it into a pattern.
7. Count **recurring phrases** across many texts with n-grams, a `Set` per text and a `Map` of
   counts.

---

# Part A: What a model needs from an app

## A1. A tool is a function with a description

A language model can't click buttons. What it can do, in every modern client, is ask the
program around it to **call a function** for it: "call `get_deck` with `{ "deckId": 6 }`". The
client runs it and pastes the answer back into the conversation. Each such function is a
**tool**, and the model chooses among them by reading three things: a **name**, a
**description**, and a **JSON Schema** for the input (a JSON document that says "an object with a
whole number `deckId`").

In Python terms, it's like handing the model this, and letting it read the docstring and the type
hints before deciding to call it:

```python
def get_deck(deck_id: int, include_text: bool = True) -> dict:
    """One deck in full: every card with how many you own, ... Use it when: ..."""
```

So the description is not documentation for people. It's the model's only instruction manual,
read every time it considers the tool.

## A2. MCP: the same request in every client

Every vendor once had its own way to declare tools. The **Model Context Protocol** (MCP) is an
open standard for it: a server lists tools, a client calls them. Messages are **JSON-RPC**, a
tiny convention for remote calls in JSON: `{ "jsonrpc": "2.0", "id": 2, "method": …, "params": …
}`, answered by `{ "id": 2, "result": … }`. Here is a real exchange with this app, sent with
`curl` while writing the lesson (shortened):

```text
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18", …}}
← {"result":{"serverInfo":{"name":"proxy-library", …},"instructions":"Proxy Library: …"}, …}
→ {"jsonrpc":"2.0","id":2,"method":"tools/list"}
← {"result":{"tools":[{"name":"get_account", …}, … 22 tools]}, …}
→ {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_decks","arguments":{}}}
← {"result":{"content":[{"type":"text","text":"{\"decks\":[{\"id\":6, …}]}"}], …}}
```

MCP can run over a program's standard input and output (a local server the client starts) or
over HTTP ("Streamable HTTP"). This app uses HTTP in **stateless** mode: every POST is complete
on its own, so a new server object handles each request and nothing is remembered between them
([http.ts](../src/app/_llm-tools/http.ts)). Clients that only start local programs use a small
bridge, `mcp-remote`, which speaks stdio on one side and HTTP on the other.

**Try it:** with the dev server running and a token from Account → Access tokens:

```sh
curl -s -H "Authorization: Bearer pl_…" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -X POST http://localhost:3000/api/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

# Part B: Tokens

## B1. Why not the cookie?

The web pages know who you are from a session cookie that the browser keeps. An LLM client
isn't a browser: it can send a header it was given, nothing more. So each player makes a
**personal access token**: a long random string the client sends as `Authorization: Bearer
pl_…`. "Bearer" means whoever holds it is let in, like a ticket, so it must be guessable by no
one and revocable at any time.

## B2. Make it random, store a hash

The secret is 32 random bytes from the operating system, written in **base64url** (letters,
digits, `-` and `_`: safe in headers and URLs) after a `pl_` prefix
([access-token.ts](../src/modules/accounts/domain/access-token.ts)):

```ts
export function tokenSecret(randomBytes: Uint8Array): string {
  if (randomBytes.length !== 32) throw new RangeError("a token needs 32 random bytes");
  const base64 = btoa(String.fromCharCode(...randomBytes));
  return PREFIX + base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
```

The database never sees the secret, only its **SHA-256 hash** (a fixed-length fingerprint you
can't turn back into the input). If the database leaked, nobody could use the hashes to get in.
Python's version is one line, `hashlib.sha256(secret.encode()).hexdigest()`.

Lesson 02 said passwords need a **slow** hash (scrypt), so why is a fast one fine here? A slow
hash protects _guessable_ secrets: people pick `dragon123`, and an attacker with the hashes can
try billions of guesses. A token is 256 random bits; there's nothing to guess, so speed doesn't
help an attacker. Every check then costs microseconds, which matters because every tool call
checks the token.

## B3. One answer for everything that's wrong

`actorFromToken` returns `null` for a missing header, a malformed token, an unknown one, a
revoked one, a disabled player and a player who must change their password
([access-tokens.ts](../src/modules/accounts/application/access-tokens.ts)). Each gets the same 401. If the answers differed ("token revoked" vs "no such token"), someone probing could learn
which tokens once existed. It's the same idea as lesson 21's "not found" for a deck you may not
see.

Two more details: the cheap shape check (`looksLikeToken`) runs before any database work, so junk
costs nothing; and "last used" is written at most once a minute (`shouldTouch`), so a chatty
client doesn't turn every read into a write.

---

# Part C: One schema, three jobs

## C1. Validation, a type, and JSON Schema

Each tool's input is one Zod schema ([decks.ts](../src/app/_llm-tools/tools/decks.ts)):

```ts
input: z.object({
  deckId: z.number().int().positive().describe("The deck's id, from list_decks."),
  includeText: z.boolean().default(true).describe("Include each card's rules text. …"),
}),
```

That one value does three jobs:

1. **At run time**, `tool.input.safeParse(raw)` checks what the model sent (models make
   mistakes: `"deckId": "seven"`), as Pydantic's `Model.model_validate(data)` does in Python.
2. **At compile time**, `z.output<typeof input>` is the TypeScript type the handler receives, so
   `input.includeText` is a `boolean`, never `undefined` (the default filled it in).
3. **For the model**, `z.toJSONSchema(input, { io: "input" })` writes the JSON Schema that both
   endpoints publish ([registry.ts](../src/app/_llm-tools/registry.ts)).

`io: "input"` matters. A field with a default is optional _to send_ but always present _after
parsing_; the input view lists only `deckId` as required, which is what a caller needs to know.

## C2. Shapes that confuse models

A big hosted model copes with any JSON Schema. A small local one, or an older function-calling
API, often doesn't handle unions: `anyOf`, `oneOf`, or a type list like
`"type": ["string", "null"]` (which Zod 4 writes for `.nullable()`). So the registry's test
walks every schema and fails on all of them ([registry.test.ts](../src/app/_llm-tools/registry.test.ts)).
The fixes are small: `.optional()` instead of `.nullable()` (leave it out rather than send
`null`), an enum instead of a union of literals, two flat fields instead of a choice between
nested shapes (`add_wish` has `printing: "any" | "exact"` plus a `card`, not a union of two
request objects).

---

# Part D: One registry, two doors

## D1. Defining a tool

A tool is plain data plus a handler ([tool.ts](../src/app/_llm-tools/tool.ts)):

```ts
export function defineTool<Input extends ToolInputSchema>(tool: LlmTool<Input>): LlmTool {
  return tool as unknown as LlmTool;
}
```

Inside `defineTool`'s argument, TypeScript knows the exact schema, so `run(context, input)` gets
a precise `input` type. The registry, though, is a list of _different_ tools, and an array has
one element type. `as unknown as LlmTool` forgets the precise type on purpose (TypeScript
refuses a direct `as` between types this different, hence the step through `unknown`). It's safe
because the only code that calls `run` first parses the input with that same tool's schema.

## D2. Adapters

`callTool` does what both endpoints need: find the tool, check the token's scope (lesson 21's
policies, again), parse the input, run it. Then each adapter only translates:

- the **MCP adapter** ([mcp.ts](../src/app/_llm-tools/mcp.ts)) answers `tools/list` from the
  registry and wraps results as MCP content, with `isError: true` for expected failures;
- the **HTTP adapter** answers `POST /api/tools/<name>` with JSON and a status code (401, 403,
  422), and [openapi.ts](../src/app/_llm-tools/openapi.ts) describes the same tools as OpenAPI, a
  format any function-calling client can import.

This is ports and adapters (lesson 01) pointed outward: the registry is the core, MCP and HTTP
are two ways in. A test asserts both list the same tools with identical schemas, so they can't
drift apart.

---

# Part E: Writing for a model

## E1. The description is the manual

Compare a description written for a person with one written for a model:

```text
Searches cards for a deck.
```

```text
Runs several card searches for one deck at once, one per synergy you name, and merges the
results. Every search is automatically limited to the deck's commander colors and format …
so don't add color or legality terms yourself.
Use it when: … Don't use it for: one known card (get_card) …
How to write the queries: … split each mechanic into enablers … and payoffs …
Reading the result: cards that matched several synergies are the strongest leads …
```

The second tells the model when to choose this tool over its neighbours, what the tool does for
it (so it doesn't repeat that work badly), how to fill in the hard parameter, and how to read
the answer. Many clients ignore MCP "prompts" and "resources", so everything essential is in the
tool descriptions; the prompts only repeat it.

## E2. Answers the model can act on

A tool's expected failures come back as data with a sentence:

```ts
return failed(
  "DeckChanged",
  "The deck changed since your get_deck. Call get_deck again, redo the edit on its new list, and send its new fingerprint.",
);
```

A model reading "Error 409" guesses. A model reading that sentence calls `get_deck` again. The
same goes for hints on searches: "Found 278; showing 20. Narrow it with t:, mv<=, tag:, theme: or
a longer phrase."

Results are also **bounded** (8 queries × 50 cards, pages of 60): a model's context window is
its working memory, and a 5,000-card answer would push the conversation out of it.

---

# Part F: Patterns from strangers

## F1. Two dialects of `\b`

Models write regular expressions the way JavaScript and Python do, where `\b` is a word boundary.
Postgres's regular expressions are a different dialect: there `\b` is a **backspace** character
and the word boundary is `\y` (or `\m` and `\M` for the start and end of a word). So
`o:/\bdies\b/` silently found nothing. `forPostgres` translates
([sql.ts](../src/shared/card-search/sql.ts)):

```ts
export function forPostgres(pattern: string): string {
  return pattern.replace(/\\(.)/g, (escape, character: string) =>
    character === "b" ? "\\y" : escape,
  );
}
```

It walks the pattern escape by escape (`\\(.)` matches a backslash and the next character), so
an escaped backslash followed by `b` (`\\b`, "a backslash, then b") stays as written.

## F2. Escaping before you substitute

In `o:"when ~ dies"`, the `~` stands for the card's own name. The SQL builds a pattern that
alternates the full name, the short name and "this creature". A name is text, not a pattern, so
its special characters must be escaped first: `Ach! Hans, Run!` has no specials, but a name with
`(`, `+` or `.` would change the pattern's meaning. Python has `re.escape(name)` for this; here it
happens in SQL with `regexp_replace(name, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')`: find each
special character and put a backslash before it (`\1` is "what the group matched").

---

# Part G: What a deck keeps doing

## G1. Rules for what has a name

`analyze_cards` looks at a whole deck for what its cards share. Named signals come from small
patterns ([signals.ts](../src/shared/card-search/signals.ts)): `(\+1\/\+1|-1\/-1|[a-z]+) counters?`
finds "spore counter", while a list of words that can't name a counter (`a`, `the`, `target`, …)
keeps "counter target spell" out.

## G2. Phrases nobody named

For mechanics no rule knows, the tool counts **n-grams**: runs of _n_ consecutive words. "put a
spore counter" has the 2-grams "put a", "a spore", "spore counter". Two details make the count
honest:

- each card's phrases go into a `Set` first, so a card that says "spore counter" three times
  counts once (in Python, `set()` before `Counter.update`);
- a phrase is dropped if a longer phrase covers exactly the same cards ("ring tempts" vs "the
  ring tempts you"), or if a named signal already says it.

The tool reports evidence; deciding that spore counters mean "look for proliferate" is the
model's job. That split (cheap, reliable counting in code; judgment in the model) is the design.

---

## Common mistakes

- **Storing the secret.** A token table with a `secret` column is a list of keys to every
  account. Store the hash; show the secret once.
- **Different errors for different bad tokens.** It tells an attacker which tokens existed.
- **A slow password hash for random tokens.** It protects nothing and slows every request.
- **Trusting the model's input.** Parse it with the schema every time; models send strings for
  numbers and invent fields.
- **Unions in tool schemas.** `.nullable()`, `z.union` and nested choices work in tests with a big
  model and fail with a small one. Prefer optional fields and enums.
- **Two endpoints, two definitions.** Hand-writing the OpenAPI document next to the MCP list
  means they drift. Generate both from one registry.
- **Errors without a next step.** "Invalid request" makes a model retry the same thing.
- **Pasting text into a pattern.** Escape it first, and know which regex dialect runs it.

## Exercises

### 1. Warm-up: read a bearer header

Write `bearer(header: string | null): string | null` that returns the token in `Bearer <token>`
(any letter case, any spaces around it) and `null` for anything else, including two words after
`Bearer`.

_Hint:_ one regular expression with `^`, `\s+`, one `(\S+)` group and `$`.

<details><summary>Solution</summary>

```ts
function bearer(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match === null ? null : match[1];
}
// bearer("bearer  pl_abc ") → "pl_abc"; bearer("Bearer pl_a pl_b") → null; bearer(null) → null
```

</details>

### 2. What the model sees

For this schema, what do `z.toJSONSchema(Input, { io: "input" }).required` and
`z.toJSONSchema(Input).required` contain, and why do they differ? What does `.nullable()` turn
into?

```ts
const Input = z.object({
  deckId: z.number().int().positive().describe("The deck's id."),
  note: z.string().optional().describe("A note."),
  limit: z.number().int().default(20).describe("How many."),
});
```

<details><summary>Solution</summary>

`["deckId"]` for input, `["deckId", "limit"]` for output. A defaulted field may be left out when
sending, but is always there after parsing. `z.string().nullable()` becomes
`{ "type": ["string", "null"] }`: a type union, which the registry's test forbids.

</details>

### 3. Phrases on many cards

Write `onManyCards(texts, length, minimum)` that returns, sorted, every `length`-word phrase
(lowercase, split on spaces) found on at least `minimum` of the texts, counting each text once
per phrase.

_Hint:_ a `Set` per text, then a `Map<string, number>`.

<details><summary>Solution</summary>

```ts
function phrases(text: string, length: number): Set<string> {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  const found = new Set<string>();
  for (let start = 0; start + length <= words.length; start++) {
    found.add(words.slice(start, start + length).join(" "));
  }
  return found;
}

function onManyCards(texts: readonly string[], length: number, minimum: number): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const phrase of phrases(text, length)) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count >= minimum)
    .map(([phrase]) => phrase)
    .sort();
}
// "spore spore spore" counts "spore" once, so with minimum 2 it isn't returned.
```

</details>

### 4. Challenge: a tiny registry

Write `defineTool` and `call(scopes, name, raw)` for tools `{ name, scope, input, run }`, where
`call` returns `{ kind: "unknown" }`, `{ kind: "forbidden", scope }`,
`{ kind: "invalid", issues }` (the paths of the bad fields) or `{ kind: "ok", text }`. Each
tool's `run` must get its input's exact type.

<details><summary>Solution</summary>

```ts
type Scope = "read" | "write";
type Tool<Input> = Readonly<{
  name: string;
  scope: Scope;
  input: z.ZodType<Input>;
  run(input: Input): string;
}>;

function defineTool<Input>(tool: Tool<Input>): Tool<unknown> {
  return tool as unknown as Tool<unknown>; // safe: call() parses with the tool's own schema
}

const tools = [
  defineTool({
    name: "greet",
    scope: "read",
    input: z.object({ name: z.string() }),
    run: (input) => `Hello, ${input.name}`, // input: { name: string }
  }),
];

type Call =
  | { kind: "ok"; text: string }
  | { kind: "unknown" }
  | { kind: "forbidden"; scope: Scope }
  | { kind: "invalid"; issues: string[] };

function call(scopes: readonly Scope[], name: string, raw: unknown): Call {
  const tool = tools.find((each) => each.name === name);
  if (tool === undefined) return { kind: "unknown" };
  if (!scopes.includes(tool.scope)) return { kind: "forbidden", scope: tool.scope };
  const parsed = tool.input.safeParse(raw);
  if (!parsed.success) {
    return { kind: "invalid", issues: parsed.error.issues.map((issue) => issue.path.join(".")) };
  }
  return { kind: "ok", text: tool.run(parsed.data) };
}
```

</details>

## Recap

- A **tool** is a name, a description and a JSON Schema; the description is the model's manual.
- **MCP** is JSON-RPC (`tools/list`, `tools/call`) over stdio or HTTP; stateless HTTP means a
  fresh server per request.
- **Bearer tokens**: 256 random bits, stored as a SHA-256 hash, shown once, and one identical
  answer for every way a token can be wrong.
- One **Zod schema** checks input, types the handler and becomes the published JSON Schema; keep
  it free of unions for small models.
- One **registry**, two **adapters**, and a test that they agree.
- Answer failures with **what to do next**, and keep results small.
- Know your **regex dialect** (`\b` vs `\y`), and escape text before putting it in a pattern.
- **N-grams** with a `Set` per text find what no rule names; code counts, the model judges.

## Further reading

- [Design doc 28](../docs/design/28-llm-tools.md) and [ADR 0022](../docs/adr/0022-llm-tool-api.md)
- [Deploy: Connect an LLM](../docs/deploy.md#connect-an-llm)
- The Model Context Protocol specification: <https://modelcontextprotocol.io/specification>
- JSON Schema: <https://json-schema.org/understanding-json-schema>
- PostgreSQL regular expressions (escapes, `\y`, `\m`, `\M`):
  <https://www.postgresql.org/docs/current/functions-matching.html>
