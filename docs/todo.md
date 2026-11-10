# To do

The working queue lives on the **Proxy Library** project in tududi
(https://tududi.devstageprod.duckdns.org), not in the repo. Work is **one feature at a time**;
ideas that come up mid-feature go to tududi's **inbox** and wait.

| Kanban column | Task status | Means                                                         |
| ------------- | ----------- | ------------------------------------------------------------- |
| In progress   | In progress | the feature being built now (one at a time)                   |
| Waiting       | Waiting     | blocked on something outside the work                         |
| To do         | Not started | no `someday` tag: up next, highest priority first             |
| To do         | Not started | tagged `someday` plus an area (`decks`, ...): ideas for later |

Don't use the **Planned** status: the kanban board has no column for it, so planned tasks
don't show up anywhere.

When a feature is picked up it gets a design doc as usual (docs/roadmap.md). Its task is done
when the phase's lesson is written and the work is committed.

[future-ideas.md](future-ideas.md) stays as the record of deferred ideas and known limits that
design docs link to. Its items are also on the board as `someday` tasks; when one is picked up,
update both.

## Big features get their own project

This tududi account is only for Proxy Library. The **Proxy Library** project is the backlog:
small features and someday ideas, one task each. A feature that won't fit in one task (several
design docs, or more than a few steps) becomes its own tududi project while it's built, for
example the recommendation improvements behind "Card ratings for recommendations".

**Starting one**

1. Create the project. Name it after the feature ("Card ratings"). In its description, write
   the goal in a sentence or two, what "done" means, and the backlog task it came from. Give it
   the same area tags as that task (`deck-building`, ...).
2. Add the first task, **Design doc NN: <feature>**, and nothing else yet. The design doc is
   written and approved before any code (docs/roadmap.md).
3. Once the doc is approved, break it into tasks, one per step that ends in a commit (a
   migration, a domain function and its tests, a page, a tool). Use subtasks for checklist
   items inside a step. Link the design doc section in each task's note.
4. Add the closing tasks: **Lesson NN**, and anything the doc's rollout section lists (a sync
   run, a worker check).
5. Set the backlog task to **Cancelled** with the note "Became project <name>". If it had
   subtasks, they become tasks in the new project, or get dropped there on purpose.

**While building it**

- The project's status is **In progress**, and it counts as the one feature being built. Inside
  it, one task is in progress at a time. The same columns apply as on the backlog.
- Tasks found along the way that belong to the feature go into its project. Anything else,
  including "it would be nice if...", goes to the inbox.
- If the design changes, update the design doc first, then the tasks.
- Keep tasks small enough to finish in a sitting. If one keeps growing, split it.

**Finishing it**

When every task is done, the lesson is written and the work is committed, set the project to
**Done**. Leftover ideas go back to the backlog as `someday` tasks (and to
[future-ideas.md](future-ideas.md) if a design doc links to them).

## Connecting

Claude Code connects to tududi's built-in MCP server through `.mcp.json`. It reads
`TUDUDI_URL` and `TUDUDI_API_KEY` from `.envrc.local` (copy `.envrc.local.example`; the key comes
from tududi's Profile → API keys). Start Claude Code from a direnv shell so they're set.
