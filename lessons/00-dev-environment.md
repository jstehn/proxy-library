# Lesson 00: Your development environment

- **Phase:** 0
- **Prerequisites:** comfortable with a terminal, Python and SQL. No JavaScript needed.
- **Time:** about 1 hour, including exercises

## Objectives

By the end of this lesson you will be able to:

1. Explain what a Nix flake and direnv provide, and how that compares to a Python virtualenv.
2. Start, stop and connect to the project's own Postgres, and read a socket-based connection
   string.
3. Find your way around a Next.js project: scripts, lockfile, `tsconfig.json`, and folder-based
   routing.
4. Read basic TypeScript: variables, typed functions, union types, `null`/`undefined`, narrowing
   and equality.
5. Read a simple React component written in JSX.

---

## 1. Reproducible environments

### The problem

"Works on my machine" happens when each machine has different versions of the tools. In Python
you solve half of this with a virtualenv: it pins **libraries**. But the interpreter itself, the
database server and the CLI tools still come from whatever happens to be installed.

### The idea

**Nix** pins **everything**: every program is built from an exact recipe and stored under
`/nix/store/<hash>-name/`, so versions never collide. A **flake** is a project file that declares
which programs the project needs. **direnv** activates it automatically when you `cd` into the
folder, and deactivates it when you leave.

| This project   | Job                                                  | Python equivalent                    |
| -------------- | ---------------------------------------------------- | ------------------------------------ |
| `flake.nix`    | declares the _tools_: node 22, pnpm, postgres 17, jq | `requirements.txt`, but for programs |
| `flake.lock`   | pins the exact package-set version                   | `uv.lock` / `poetry.lock`            |
| `.envrc`       | direnv script: load the flake, set env vars          | `source .venv/bin/activate` + `.env` |
| `package.json` | declares the _JavaScript libraries_                  | `pyproject.toml`                     |

There are two layers: **Nix provides programs** (`node`, `psql`) and **pnpm provides the
libraries** our code imports (`next`, `zod`). Each manages only its own layer.

Here is the heart of [`flake.nix`](../flake.nix):

```nix
devShells.default = pkgs.mkShell {
  packages = with pkgs; [ nodejs_22 pnpm postgresql_17 jq ];
};
```

And of [`.envrc`](../.envrc):

```bash
use flake                                   # activate the dev shell above
export PGHOST="$PWD/.dev"                   # project-specific environment variables
export DATABASE_URL="postgres://tcg@localhost/tcg?host=$PWD/.dev"
```

> **Try it:** run `which node` inside the project, then `cd ~` and run it again. Inside, the path
> points into `/nix/store/…`. Outside, it's your system Node, or nothing at all.

## 2. A database that lives in the project

### The problem

A system-wide Postgres is shared state outside the repo. It can have a different version,
leftover databases, or a port another project is already using.

### The idea

Postgres is just a program that stores its data in a folder. We run it **as you**, with its data
in `.dev/pgdata` (gitignored), started and stopped by [`scripts/db.sh`](../scripts/db.sh):

```sh
pnpm db:start    # create the data folder on first run, start the server, create databases
pnpm db:stop
pnpm db:reset    # stop, delete all data, start fresh
```

### Sockets instead of ports

Most databases listen on a **network port** (`localhost:5432`). Ours doesn't:

```bash
pg_ctl start -o "-k $PGHOST -c listen_addresses=''"
```

- `listen_addresses=''` means no network port at all.
- `-k $PGHOST` creates a **Unix socket** instead: a special file (`.dev/.s.PGSQL.5432`) that
  programs on the same machine connect through. Think of it as a private phone line. Nothing on
  the network can reach it, and it can't clash with another Postgres.

### Reading the connection string

```
postgres://tcg@localhost/tcg?host=/home/you/…/tcg-virtual-library/.dev
   │       │    │         │   └─ where to actually connect: the socket's folder
   │       │    │         └─ database name
   │       │    └─ a placeholder host (the URL format needs one; ?host= overrides it)
   │       └─ user
   └─ protocol
```

Command-line tools use the `PG*` variables instead. When `PGHOST` is a path (it starts with `/`),
`psql` looks for a socket in that folder. That's why a bare `psql` just works here.

The app never hardcodes any of this; it reads `DATABASE_URL`. When we move to Docker later, only
that one string changes.

> **Try it:** `pnpm db:start`, then `ls -a .dev/`. Find the `.s.PGSQL.5432` socket file. Run
> `psql -c 'select current_database()'`.

## 3. Anatomy of a Next.js project

**Next.js** is a framework that runs React pages _and_ server code in one app, roughly like
Django, which also bundles views and server logic.

| File                 | What it is                                                                   |
| -------------------- | ---------------------------------------------------------------------------- |
| `package.json`       | dependencies and **scripts**: `pnpm dev` runs `scripts.dev`, like a Makefile |
| `pnpm-lock.yaml`     | exact resolved versions of every library. Commit it, never edit it.          |
| `tsconfig.json`      | TypeScript compiler settings                                                 |
| `eslint.config.mjs`  | lint rules (like ruff)                                                       |
| `.prettierrc.json`   | formatter settings (like black)                                              |
| `src/app/layout.tsx` | the page shell (`<html>`, `<body>`) that wraps every page                    |
| `src/app/page.tsx`   | the page at `/`                                                              |

### Two `tsconfig.json` settings that matter most

- `"strict": true` turns on the strictest checks, most importantly **null checks**: a value that
  might be `null` can't be used until you've checked it. It's like running mypy `--strict`, except
  the build fails when it's violated.
- `"paths": { "@/*": ["./src/*"] }` means `import … from "@/shared/kernel"` refers to
  `src/shared/kernel`, from anywhere, without `../../..` chains.

### Routing is folders

The folder structure under `src/app/` **is** the URL structure:

```
src/app/page.tsx               →  /
src/app/collection/page.tsx    →  /collection
src/app/api/health/route.ts    →  /api/health   (an API endpoint instead of a page)
```

> **Try it:** `pnpm dev`, then open <http://localhost:3000> and <http://localhost:3000/api/health>.

## 4. TypeScript basics

TypeScript is JavaScript plus type annotations. The annotations are checked by the compiler and
then **erased**: what actually runs is plain JavaScript. It's the same deal as Python type hints,
except the checker is always on.

### Variables

```ts
const limit = 15; // can't be reassigned (use this by default)
let opened = 0; // can be reassigned
opened += 1;
// never use `var`: it's the old, confusingly scoped version
```

### Functions with types

```ts
function formatCount(count: number): string {
  return `${count} cards`; // backticks + ${} = f-string
}
```

This reads like `def format_count(count: int) -> str:`. The type goes after the name, and the
return type after the parentheses. Note that JavaScript has one `number` type for both integers
and floats.

### Union types: "one of these"

```ts
function describe(price: string | null): string { … }
```

`string | null` is Python's `str | None`. The `|` means "or".

### Two kinds of nothing: `null` and `undefined`

Python has one `None`. JavaScript has two:

- `undefined` means "never set": a missing property, or an argument that wasn't passed.
- `null` means "deliberately empty".

`value == null` (with two `=`) catches **both**. It's the one place loose equality is useful.

### Equality: always `===`

```ts
0 == "0"; // true  (!)  loose equality converts types first
0 === "0"; // false      strict equality: same type AND same value
```

Use `===` and `!==` everywhere, except for the `== null` idiom above.

### Narrowing: the payoff of strict mode

Here's a real function from the project, `Cents.fromUsd` in
[`src/shared/kernel/money.ts`](../src/shared/kernel/money.ts), slightly simplified:

```ts
fromUsd(value: string | null | undefined): Cents | null {
  if (value == null) return null;                  // (1)
  const match = USD_PATTERN.exec(value.trim());    // (2)
  if (match === null) return null;
  …
}
```

At (1), `value` might be `string`, `null` or `undefined`. After the `if … return`, TypeScript
**narrows** it: on line (2) it knows `value` must be a `string`, so `value.trim()` is allowed.
Delete line (1) and the compiler refuses to build, because `null.trim()` would crash at runtime.
This habit of checking first so the compiler can narrow is the most important one in TypeScript.

(`Cents` itself is a special "branded" type. Lesson 01 explains it.)

### Modules

```ts
export function formatCount(…) { … }              // make it importable
import { formatCount } from "@/shared/format";    // import it elsewhere
```

Anything not exported is private to its file, which is stricter than Python's `_underscore`
convention.

> **Try it:** run `node` to open a REPL (like `python`). Type `0.1 + 0.2`, then `0 == "0"`, then
> `0 === "0"`.

## 5. React components and JSX

A **React component** is a function that returns markup. From
[`src/app/page.tsx`](../src/app/page.tsx), simplified:

```tsx
export default function Home() {
  const examplePrice = Cents.fromUsd("0.30");
  return (
    <main className="mx-auto max-w-3xl px-4">
      <ul>
        {sections.map((section) => (
          <li key={section.name}>{section.name}</li>
        ))}
      </ul>
    </main>
  );
}
```

- The HTML-looking syntax is **JSX**, allowed in `.tsx` files. It compiles to function calls.
- `{ … }` inside JSX switches back to TypeScript. `sections.map((section) => …)` is the list
  comprehension `[<li> for section in sections]`, and `(section) => …` is a lambda.
- `key` lets React track list items between renders. It must be unique among siblings.
- `className` (not `class`) holds **Tailwind** utility classes: `px-4` is horizontal padding,
  `max-w-3xl` is max width, and `dark:` prefixes apply in dark mode.
- `export default` marks the one thing this file provides. Next.js looks for it in `page.tsx`.

This component runs **on the server** (a _Server Component_, the default) and sends finished
HTML to the browser. Components that react to clicks run in the browser. Those come later.

## Common mistakes

| Mistake                                              | Why it happens                                          | Avoid it by                                             |
| ---------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| A new file is "missing" when Nix evaluates the flake | flakes only see files **tracked by git**                | `git add` new files the flake needs                     |
| `psql: could not connect`                            | Postgres isn't running, or direnv isn't loaded          | `pnpm db:start`; check `echo $PGHOST`; `direnv allow`   |
| Using `==` and getting surprising `true`s            | loose equality converts types                           | always `===`, except `x == null`                        |
| Following an old Next.js tutorial                    | Next 16 changed APIs (e.g. "middleware" is now "proxy") | read the docs shipped in `node_modules/next/dist/docs/` |
| `pnpm -s …` fails                                    | pnpm 12 removed the `-s` flag                           | plain `pnpm <script>`                                   |

## Exercises

### 1. Where do tools come from? (warm-up)

Run `which psql` inside the project folder and outside it. Explain the difference.

<details><summary>Solution</summary>

Inside, `psql` resolves to `/nix/store/…-postgresql-17…/bin/psql`, because direnv loaded the
flake and put that folder first on `PATH`. Outside, it's either your system's `psql` or "not
found". The project's tools exist only while you're in the project.

</details>

### 2. Watch the socket (warm-up)

Start the database and list `.dev/`, then stop it and list again. What appears and disappears,
and why can't another computer on your network connect?

<details><summary>Solution</summary>

`.s.PGSQL.5432` (and a `.lock` file) appear while the server runs and vanish when it stops.
Because `listen_addresses=''`, Postgres opens no network port at all. The socket is a local file,
reachable only by processes on this machine that can access the folder.

</details>

### 3. Let the compiler catch a bug

In `src/app/page.tsx`, change `Cents.fromUsd("0.30")` to `Cents.fromUsd(42)` and run
`pnpm typecheck`. Read the error, then explain why catching it here is better than at runtime.
Undo the change afterwards.

<details><summary>Solution</summary>

```
error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.
```

`fromUsd` declares `value: string | null | undefined`. A number would reach `value.trim()`, and
numbers have no `.trim()`, so the page would crash for every visitor. The compiler rejects it
before the code ever runs.

</details>

### 4. Write a narrowing function

In a scratch `.ts` file, write `label(count: number | null): string` that returns
`"not counted yet"` for `null` and `"<n> cards"` otherwise. Then try to use `count` before the
null check and read the error.

<details><summary>Hint</summary>

Check for `null` first and `return` early. After that, TypeScript knows `count` is a number.

</details>

<details><summary>Solution</summary>

```ts
function label(count: number | null): string {
  if (count === null) return "not counted yet";
  return `${count} cards`;
}
```

Something like `count.toFixed(0)` before the check fails with
`'count' is possibly 'null'`. That's strict null checking at work.

</details>

### 5. Why the project stores money as integers

In the Node REPL, evaluate `0.1 + 0.2` and `0.29 * 100`. What would happen if a wallet stored
dollars as floats and added thousands of prices?

<details><summary>Solution</summary>

`0.30000000000000004` and `28.999999999999996`. Most decimal fractions have no exact binary
representation, so float sums drift by tiny amounts that eventually show up as wrong balances.
The project stores **integer cents**, which are exact, and only formats as dollars for display.
Lesson 01 shows how the type system enforces this.

</details>

### 6. Add to the page (challenge)

Add a "Profile" card for phase 11 to the `sections` list in `src/app/page.tsx` with `pnpm dev`
running. What happens in the browser when you save?

<details><summary>Solution</summary>

Add `{ name: "Profile", phase: 11, blurb: "Your public stats." }` to the array. The page updates
without a manual reload, because the dev server's **hot reload** re-renders changed components.
Because `name` is used as the `key`, it must be unique among the cards.

</details>

## Recap

- **Nix provides programs, pnpm provides libraries.** direnv switches both on when you enter the
  folder.
- The database is **project-local and socket-only**. Its location comes from env vars, never
  hardcoded.
- Next.js **routes are folders**. `page.tsx` is a page, and `route.ts` is an API endpoint.
- TypeScript types are **checked, then erased**. `strict` mode makes `null` explicit.
- **Narrow before use:** check for `null`/`undefined` first, and the compiler lets you proceed.
- Use `===` always, `== null` as the one exception, and `const` by default.

## Further reading

- [ADR 0010: Nix flake + direnv](../docs/adr/0010-nix-dev-environment.md)
- TypeScript Handbook, "Everyday Types" and "Narrowing":
  <https://www.typescriptlang.org/docs/handbook/2/everyday-types.html>
- Next.js docs for this exact version: `node_modules/next/dist/docs/01-app/01-getting-started/`
