# Lesson 00: Dev environment & first TypeScript

**Phase 0 of the build plan.** By the end you have a reproducible toolchain, a private Postgres,
and a running Next.js app. You'll also have read your first TypeScript module.

## Contents

1. [The toolchain: Nix flake + direnv](#1-the-toolchain-nix-flake--direnv)
2. [A project-local Postgres](#2-a-project-local-postgres)
3. [The Next.js project, file by file](#3-the-nextjs-project-file-by-file)
4. [First TypeScript: `money.ts`](#4-first-typescript-moneyts)
5. [First React: `page.tsx`](#5-first-react-pagetsx)
6. [Daily commands](#6-daily-commands)
7. [Exercises](#7-exercises)

---

## 1. The toolchain: Nix flake + direnv

| File           | Job                                                    | Python analogy                       |
| -------------- | ------------------------------------------------------ | ------------------------------------ |
| `flake.nix`    | Declares the _tools_: node 22, pnpm, postgres 17, jq   | `requirements.txt`, but for binaries |
| `flake.lock`   | Pins nixpkgs to an exact commit (identical versions)   | `uv.lock` / `poetry.lock`            |
| `.envrc`       | Read by direnv on `cd`: loads the flake, sets env vars | auto-activating venv + `.env`        |
| `package.json` | Declares the _JavaScript libraries_ (next, react, …)   | `pyproject.toml`                     |

There are two layers. **Nix** provides programs (`node`, `psql`), and **pnpm** provides the
libraries our code imports. Nix doesn't manage `node_modules`, and pnpm doesn't manage Node.

What happens on `cd`:

```
cd tcg-virtual-library
  └─ direnv reads .envrc
       ├─ use flake    → Nix puts node, pnpm, postgres from /nix/store/... first on PATH
       └─ export ...   → PGDATA, PGHOST, PGUSER, PGDATABASE, DATABASE_URL, IMAGE_CACHE_DIR
```

Leave the folder and it's all undone. Try `which psql` inside and outside the project.

> **Gotcha:** flakes only see files that are **tracked by git**. A new file referenced by the
> flake must be `git add`ed first, or Nix acts like it doesn't exist.

## 2. A project-local Postgres

`scripts/db.sh` runs Postgres as a normal process you own, with no system service and no Docker.

- **Where the programs come from:** `initdb`, `pg_ctl`, `psql`, `createdb` all come from the
  flake's `postgresql_17` and are on PATH thanks to direnv.
- **Where the data lives:** `PGDATA=.dev/pgdata`. This is a folder of database files, like a
  SQLite file but a directory. `.dev/` is gitignored.
- **What the script does:**
  - `start`: `initdb` if the folder is new, then `pg_ctl start`, then `createdb tcg` if
    missing. It's safe to run twice.
  - `stop`: fast shutdown.
  - `reset`: stop, delete the data, start fresh.
  - `set -euo pipefail` at the top means "stop on the first error," like an uncaught
    Python exception.

### How addressing works: a Unix socket, not a port

```bash
pg_ctl start -o "-k $PGHOST -c listen_addresses=''"
```

- `listen_addresses=''` opens **no network port**.
- `-k $PGHOST` creates a **socket file** at `.dev/.s.PGSQL.5432` instead. A socket is a local-only
  "phone line" that programs on this machine connect through. Nothing on your network can reach
  it, and it can't clash with another Postgres on port 5432. That's why `--auth=trust` (no
  password) is fine here.

How clients find it:

- `psql`/`createdb` read `PGHOST`. When it's a path (starts with `/`), they look for the socket in
  that folder. `PGUSER`/`PGDATABASE` fill in the rest, so a bare `psql` just works.
- The app reads `DATABASE_URL`:

```
postgres://tcg@localhost/tcg?host=/home/.../tcg-virtual-library/.dev
   │       │    │         │   └─ the real destination: the socket folder
   │       │    │         └─ database name
   │       │    └─ placeholder hostname (overridden by ?host=)
   │       └─ user
   └─ protocol
```

In Phase 10 (Docker) only this string changes, to e.g. `postgres://tcg:pw@db:5432/tcg`. The code
never hardcodes connection details. It only reads env vars.

## 3. The Next.js project, file by file

Scaffolded with `create-next-app` (Next **16**, React 19, Tailwind 4, TypeScript 5.9).

| File                                | What it is                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `package.json`                      | Dependencies + **scripts** (`pnpm dev` runs `scripts.dev`). Like `[project.scripts]` / a Makefile.   |
| `pnpm-lock.yaml`                    | Exact resolved versions of every library. Commit it and never edit it by hand.                       |
| `pnpm-workspace.yaml`               | pnpm settings. `allowBuilds: sharp: false` stops a native image lib from compiling (handy on NixOS). |
| `tsconfig.json`                     | TypeScript compiler settings. See below.                                                             |
| `next.config.ts`                    | Next.js settings (empty for now).                                                                    |
| `eslint.config.mjs`                 | Linter rules (≈ ruff/flake8).                                                                        |
| `.prettierrc.json`                  | Formatter settings (≈ black). The tailwind plugin sorts class names.                                 |
| `postcss.config.mjs`, `globals.css` | Tailwind wiring.                                                                                     |
| `src/app/layout.tsx`                | Root **layout**: the `<html>`/`<body>` shell that wraps every page.                                  |
| `src/app/page.tsx`                  | The page at `/`.                                                                                     |
| `AGENTS.md` / `CLAUDE.md`           | Notes for AI assistants (AGENTS.md is regenerated by `next dev`).                                    |

### `tsconfig.json` highlights

- `"strict": true`: the important one. It turns on null checks, among other things. `string | null`
  can't be used as a `string` until you've checked it. Think of it as mypy `--strict`, but enforced
  on every build.
- `"noEmit": true`: `tsc` only _checks_ types. Next.js does the actual compiling to JavaScript.
- `"paths": { "@/*": ["./src/*"] }`: `import { x } from "@/lib/money"` means `src/lib/money.ts`,
  so there's no `../../..` chain.

### Routing = folders

The App Router maps folders to URLs. `src/app/page.tsx` is `/`, and `src/app/collection/page.tsx`
will be `/collection`. `layout.tsx` wraps everything below it.

### Next 16 differences worth knowing

- Docs for the _installed_ version live in `node_modules/next/dist/docs/`. Prefer them over
  older tutorials.
- "Middleware" is now called **proxy** (`proxy.ts`). We'll use it for auth in Phase 2.
- Types like `LayoutProps<"/">` are **generated** into `.next/types`. That's why
  `pnpm typecheck` runs `next typegen` before `tsc`.

## 4. First TypeScript: `money.ts`

> **Update (Phase 1):** this file moved to `src/shared/kernel/money.ts` and became a branded
> `Cents` type with a companion object (`Cents.fromUsd`, `Cents.format`). See lesson 01. The
> ideas below still apply.

Open `src/lib/money.ts`. Line by line, compared with Python:

```ts
export type Cents = number;
```

A **type alias**, like `Cents = int` in Python typing. It has zero runtime cost and just
documents intent. (JavaScript has only one number type, a 64-bit float, so "integer" is a
promise we keep ourselves with `Math.round`.)

```ts
export function formatCents(cents: Cents): string {
```

≈ `def format_cents(cents: Cents) -> str:`. `export` makes it importable. Without it, it's
module-private, like a leading `_`, except enforced.

```ts
export function parseUsd(value: string | null | undefined): Cents | null {
  if (value == null || value.trim() === "") return null;
```

- `string | null` is a **union type**, the same as `str | None`.
- JS has _two_ "nothing" values, `null` and `undefined` (a missing property). `value == null`
  (double `=`) is the one deliberate use of loose equality: it catches both.
- Everywhere else, use `===`. Loose `==` does surprising conversions (`"0" == 0` is true).
- After that `if`, TypeScript **narrows** `value` to `string`. Delete the check and
  `value.trim()` becomes a compile error. This is the "strict null checks" payoff.

```ts
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
```

`const` is a binding that can't be reassigned (use it by default; `let` when you must
reassign; never `var`). `Intl` is the built-in locale formatting library. `{ style: ... }` is an
**object literal**, which behaves like a dict.

Why cents: `0.1 + 0.2` is `0.30000000000000004` in both JS and Python. Summing float prices in a
wallet eventually shows up as a wrong balance, so we store integers and format only when
displaying.

## 5. First React: `page.tsx`

```tsx
export default function Home() {
  const examplePrice = parseUsd("0.30");
  return (
    <main>
      ...
      {sections.map((section) => (
        <li key={section.name}>...</li>
      ))}
      ...
    </main>
  );
}
```

- A **component** is a function that returns markup (JSX, the HTML-looking syntax in `.tsx`
  files). `export default` marks it as _the_ thing this file provides, which is what Next looks
  for.
- `{ ... }` inside JSX drops back into JavaScript. `sections.map(...)` is the list comprehension
  `[<li> for section in sections]`.
- `key` helps React track list items between renders. It must be unique among siblings.
- `className` (not `class`) holds Tailwind utility classes: `px-4` is horizontal padding, `sm:` means
  "on screens ≥ small", and `dark:` means "in dark mode".
- This is a **Server Component** (the App Router default). It runs on the server and sends
  finished HTML. Anything needing clicks or state will be marked `"use client"`, which comes up in
  later phases.

## 6. Daily commands

```sh
direnv allow          # once, and again after .envrc changes
pnpm db:start         # start Postgres (db:stop, db:status, db:reset)
pnpm dev              # dev server with hot reload → http://localhost:3000
pnpm typecheck        # generate route types + tsc
pnpm lint             # eslint
pnpm format           # prettier --write (format:check to only check)
pnpm build            # production build (catches more errors than dev)
```

> **pnpm 12 note:** the old `-s` (silent) flag is gone. Use `pnpm <script>`.

Outside a direnv shell (e.g. scripts, CI), prefix a command with `nix develop -c`.

## 7. Exercises

1. `pnpm db:start`, then `ls -la .dev/` and find the socket file. `pnpm db:stop` and watch it
   disappear.
2. In `page.tsx`, change `parseUsd("0.30")` to `parseUsd(null)` and reload. Then try `parseUsd(42)`
   and run `pnpm typecheck`. Read the error. That's the compiler catching a bug before runtime.
3. In `money.ts`, delete the `value == null` guard and run `pnpm typecheck`. Why does
   `value.trim()` fail now?
4. Add a `phase` 10 "Profile" card to `sections` in `page.tsx`. Notice that the page hot-reloads.
5. In Node's REPL (`node`), run `0.1 + 0.2`, then `Math.round(0.1 * 100 + 0.2 * 100)`.
