# The refactor: how to run a session

This folder turns the audit ([design doc 65](../design/65-codebase-audit-and-refactor.md)) into
**work packages** small enough for one session each. A session, or an agent, can start from a
clean context, read three or four short files, and work without reading the whole audit.

## Starting a session (read these, in order)

1. **This file.**
2. **[STATUS.md](STATUS.md):** which packages are done, in progress or free, what's broken right
   now, and the decisions already made.
3. **Your package**, `packages/Pnn-*.md`. It lists the files to touch, the steps, what "done"
   means, and the commands that re-check its numbers.
4. **If your package merges duplicates** (it has a **Recipe** line), Part A of
   [dedup-playbook.md](dedup-playbook.md) once, then only your group's section. It says where the
   copies are, what the single version looks like, the edge cases to test and the mistakes to
   avoid.
5. **[removal-list.md](removal-list.md): every row that names your package.** Those rows are part of
   your package's Done when even if the package file doesn't list them. Delete each row in the
   commit that removes the thing.

Read doc 65 only when your package points to one of its sections. To save tokens, filter long
output (`grep`, `tail`, `head`), and don't read files the package doesn't name unless a step needs
them.

## Working as a team on tududi

Treat the board as the team's shared log. The user and other sessions read it to see what's
happening without opening the repo. The board is the ProxyLib account's project **"Refactor:
audit and consolidation (doc 65)"** (uid `saajqvk9drbreic`). Every package is a task named
`Pnn. …`, every open decision is a task named `Decision: …`, and dependencies are task
relations.

| When                                          | Do on tududi                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before starting                               | Read the task's comments and relations (`list_task_comments`, `list_task_relations`). The user may have changed something in the UI                 |
| Starting                                      | Set the task to `in_progress` and comment: session name, branch, worktree                                                                           |
| A step lands, or something surprising happens | Comment, in a line or two: what changed, the commit's short SHA, what's next. This is the work log                                                  |
| You break something on `refactor/main`        | Comment on your task, and on the task that will fix it                                                                                              |
| You find new work                             | Create a task in the project, with a `blocks` / `blocked_by` / `related_to` relation to the tasks it affects. Don't widen your package to absorb it |
| An idea outside the refactor                  | Add it to the inbox                                                                                                                                 |
| You're blocked                                | Set the task to `waiting`, comment why, and add a `blocked_by` relation to what blocks it                                                           |
| The plan turns out wrong                      | Comment with the change and why, update doc 65 (and its change log) and the package file. Ask the user first for big changes                        |
| A decision is made                            | Comment the answer on the `Decision: …` task, mark it done, and copy the answer into STATUS                                                         |
| The package merges                            | Comment a summary (lines before and after, deliberate differences from the reference outputs), then mark it `done`                                  |

Tools: the `tududi` MCP server (`add_task_comment`, `create_task`, `update_task`,
`create_task_relation`, `list_task_comments`, `create_note`, …). If it isn't connected in your
session, `python3 scripts/tududi-mcp.py call <tool> '<json>'` calls the same tools. Never use the
`planned` status for tasks (the board has no column for it). Use the ProxyLib account only, never
the user's personal one.

## Picking a package

- Take a package whose status is **free** and whose **Depends on** packages are all **done**.
- Before starting, set it to **in progress** in `STATUS.md` with your session name (one commit on
  `refactor/main`), so two sessions never take the same package.
- Packages marked **Parallel with** can run at the same time in separate worktrees. Others must
  wait, because they touch the same files.
- If a package needs a decision listed under **Decisions needed** in STATUS, stop and ask the user.

## Branches

```
main ───────●──────────────────────────────●───────────────●──▶   always shippable (what you play on)
             \  tag: pre-refactor          ▲ milestone 1   ▲ milestone 2 …
              \                            │ (user merges) │
refactor/main  ●──●────●────●────●─────────●───────────────●───   integration: may be broken
                   \  /      \  /  \      /
  refactor/P02-…    ●●        ●●    ●────●    one branch per package, merged back when done
```

There are three levels of branch (four for big packages). Expect a lot of branches and merges;
the rules below keep them cheap.

| Level           | Name                        | Cut from                 | Merged into           | Lives                      |
| --------------- | --------------------------- | ------------------------ | --------------------- | -------------------------- |
| Shippable       | `main`                      | —                        | —                     | always                     |
| Integration     | `refactor/main`             | `main` at `pre-refactor` | `main`, at milestones | until milestone 3          |
| Package         | `refactor/Pnn-short-name`   | `refactor/main`          | `refactor/main`       | one package (1–3 sessions) |
| Step (optional) | `refactor/Pnn.k-short-name` | its package branch       | its package branch    | one session                |

- **`main` stays shippable.** Only bug fixes go to `main` while the refactor runs. `main` is
  merged into `refactor/main` (never the reverse) at the start of each wave, so fixes don't pile
  up into one big conflict at the end.
- **`refactor/main` is allowed to be broken.** Features may stop working for a while; they get
  rebuilt on the new architecture. Every breakage is listed under **Broken right now** in STATUS,
  with the package that will fix it. Nobody commits work directly to `refactor/main`; only merges
  and STATUS updates go there.
- **One branch per package**, cut from the current `refactor/main`. Parallel sessions each use
  their own git worktree (`git worktree add ../tcg-Pnn refactor/Pnn-…`), so they never share a
  checkout.
- **Step branches** are for a package too big for one session (P03, P05–P09, P11, P18): one per
  step in its **Steps** list, merged into the package branch when the step's tests pass. The
  package branch merges into `refactor/main` only when the whole package is done.
  (`refactor/Pnn.k-…` and not `refactor/Pnn-…/k`, because git can't hold both a branch and a
  folder with the same name.)
- **Stay close to `refactor/main`.** At the start of every session on a package branch, merge
  `refactor/main` into it (`git merge refactor/main`). Small, frequent merges keep conflicts small,
  and parallel packages see each other's work early. Use merges, not rebases, once a branch has
  been pushed or shared by more than one session.
- **Merging a package back:** merge `refactor/main` into the package branch, run the merge gate
  (below), update STATUS on the package branch, then `git merge --no-ff` into `refactor/main`, so
  each package stays one visible unit in history. Delete the package and step branches and the
  worktree afterwards.
- **Conflicts:** the package merging **second** resolves them, on its own branch, before it
  merges. If a conflict is in a file another package owns (its **Touches** list), ask that
  package's session (or the user) rather than guessing.
- **Approval:** ask the user before merging into `refactor/main`, unless STATUS's **Decisions
  made** records a standing OK for package merges that pass the gate. Merging into `main` (a
  milestone) always needs the user's go-ahead and the full suite green (`pnpm check`,
  `pnpm test:int`, `pnpm test:e2e`).
- **Pushing:** push `refactor/main` and active package branches to `origin` when the user agrees,
  so sessions on other machines or in the cloud can pick them up.

## The merge gate (package → `refactor/main`)

| Must pass                                                                | Why                                                                                                                                 |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` and `pnpm lint`                                         | Other sessions build on `refactor/main`, so it must compile                                                                         |
| Unit tests **for the code this package wrote or moved**                  | New architecture, new tests                                                                                                         |
| `pnpm test:int`, only if the package changed SQL, repositories or wiring | Unit tests can't see SQL mistakes; other packages skip it to keep runs fast (see the table below)                                   |
| The size and clone reports (P00) show no **new** offenders               | See "File size" below                                                                                                               |
| Every other failing test is listed in STATUS                             | Breaking is fine; _unknown_ breakage isn't. Each entry names the package that will fix it, or says "delete: tests old architecture" |

**Tests.** Old tests for code that's being replaced are deleted along with that code, not ported
line by line. The package writes new tests against the new design. The P00 reference outputs
(`docs/refactor/reference/`) describe what the old code returned, so rebuilt features can be
compared with them. They're a guide, not a gate: a deliberate change is fine, but write it down.

### Which tests to run, and when

Tests get run over and over in this refactor, so the slow and outside ones are opt-in: run them
only when your package works on what they cover.

| Suite                                                                  | Speed                      | Run it                                                                                                     |
| ---------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Unit, one file (`pnpm vitest run <path>`)                              | seconds                    | All the time while building                                                                                |
| Unit, all (inside `pnpm check`)                                        | about 10 s                 | Before each commit                                                                                         |
| Integration, one file (`pnpm vitest run --project integration <path>`) | seconds to a minute        | When your package changes SQL, a repository or wiring, for the files it touched                            |
| Integration, all (`pnpm test:int`)                                     | about 1 min, needs the DB  | At the merge gate, **only** if the package changed SQL, repositories or `src/server`; always at milestones |
| End to end (`pnpm test:e2e`)                                           | minutes, a browser         | At milestones. In a package, only the one spec for a page you changed (`pnpm test:e2e tests/e2e/<spec>`)   |
| Remote (`*.remote.test.ts`)                                            | calls MTGJSON, Scryfall, … | **Never** as a routine check. Only the one file, by hand, when your package changes that gateway           |

No unit or integration test can reach the network: `tests/setup/no-network.ts` makes `fetch`
reject. If a test fails with "Tests stay offline", give the code a fake `fetchFn` or a recorded
fixture; don't remove the guard.

## File size: the 500-line benchmark

A source file over **500 lines** is a sign that it does more than one job. It isn't a hard limit:
some files are fine longer (a big lookup table, a schema). The P00 script (`pnpm sizes`) lists
every file over 500 lines. `docs/refactor/oversize-allowlist.txt` holds the ones allowed to be
over, **each with a one-line reason**.

- A file over 500 lines that isn't on the allowlist **fails `pnpm check`**. Split it, or add it
  with a reason.
- The 28 files over 500 today start on the allowlist with "pre-refactor, owned by Pnn". The
  package that owns one removes it from the list when it's split.
- `index.ts` files count too. A public API over 500 lines means the module is too big (P18).
- Test files are reported but not gated. Prefer one test file per unit under test.

## Ending a session

Before stopping, even partway through:

1. Commit to your package branch (or merge it, if the gate passes and the user agrees).
2. Update **STATUS.md**: the package's status, anything you broke, and any new decision needed.
3. Record the package's **source lines before and after** (`pnpm sizes`) in its handoff. Less code
   is a goal: a package that grows the total needs a sentence saying why.
4. Fill in the **Handoff** section at the bottom of your package file: what's done, what's left,
   and anything surprising. Keep it short; it's what the next session reads first.
5. Add a **"Superseded in part"** line to every design doc whose code you replaced (playbook,
   Part A step 15). Commit it with the package.
6. **A deferral edits the receiving package.** If you leave work for another package, add it to
   that package's file (its Steps and Done when) in the same commit. A handoff line saying "P19
   does that" isn't enough: nobody reads it there (milestone 1 review, finding 5).
7. If something couldn't be verified in the session (it needs the network, a browser or a
   person's eye), add it to [deferred-checks.md](deferred-checks.md) instead of leaving it in a
   comment.

New ideas that aren't part of a package go to the **Backlog** in STATUS (and to tududi's inbox
when it's connected), not into the current work.

## Leaving something behind

If your package leaves scaffolding, a duplicate or dead code, add a row to [removal-list.md](removal-list.md) in the same commit, naming the package that removes it, and mention it in your handoff.
