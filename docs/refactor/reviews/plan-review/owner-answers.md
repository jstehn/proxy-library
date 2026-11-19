# The owner's answers on the project's philosophy (2026-11-19)

These answers shape the revised plan. Questions without an answer yet are listed at the bottom.

1. **Who the code is written for: yes.**
   - Write it for an experienced web developer, and keep it readable for a TypeScript newcomer.
   - Teaching goes in `lessons/`, not in code comments.
2. **Comments: (b).**
   - Exported functions get a short summary.
   - Other comments explain _why_, never restate what the code does.
   - Teaching comments that do restate it get trimmed.
3. **Reads: (a), an honest query layer** (what the architecture review calls "Option 1", CQRS-style).
   - Reads are each module's typed SQL query functions, written once and called directly by pages
     and actions through a documented read layer.
   - Capabilities are for writes and for anything with rules or permissions.
   - The one-line forward bundles (`deckReads`, `storeReads` and the rest) are removed.

4. **Module size: (a).** A few larger modules, split by responsibility inside.
5. **UI building blocks: yes.** A small set of shared components in `src/ui`. Long repeated class
   strings in pages are not allowed.
6. **Docs at the end: (a).** One page per module plus the ADRs. The old design docs are archived.
7. **Refactor docs: yes.** `docs/refactor/` is archived when the refactor ends.
8. **Clarity over line count.** The line count is a guard against bloat, not a goal.
9. **Tests: (a).** Test behaviour through capabilities and pure functions. Fix the flaky and slow
   tests.
10. **Polish: yes to all three.** CI, a README with a screenshot and a diagram, and CONTRIBUTING.
    Note: the user mostly relies on pre-commit checks, but the repo has no pre-commit hook yet, so
    P34 adds one running the fast part of `pnpm check`.
11. **Features that look unused:** delete them without asking when they're obviously already cut,
    or when what they do is done elsewhere. Otherwise bring them to the user.
12. **Lessons move to their own repo.** This changes ADR 0023 and `CLAUDE.md` ("Lesson: yes"
    becomes a pointer to that repo); it goes into P34.

**From the reviews:**

- **The repo is public.** The user wants it free to use and edit with no attribution, and paid use
  only with their permission, under a standard licence. If no standard licence does that, it stays
  completely open. _Pending:_ the choice between the two options in the recommendation.
- **CI on GitHub Actions: fine.** Pre-commit hooks are the user's main habit.
- **Pages reading through a query layer that knows about the database:** the user leans yes and
  asked for the costs and benefits (given in the conversation). _Pending._
- **`collection` and `real-collection`: merge them**, unless there's a purpose to keeping them
  apart. Design doc 16's purpose (real cards never touch the game's money) is kept inside the merged
  module (P30).
- **The AI-authorship note:** keep it clear and honest, lower in the README, not the first thing a
  reader sees.

## Still open

- the licence choice
- the query-layer detail
- approving the revised plan
- the dead-code list (P24, items a to f)
- domain questions D1 to D5
- the UI review's questions: `<img>` policy, custom error pages, colour tokens, dark-mode toggle
