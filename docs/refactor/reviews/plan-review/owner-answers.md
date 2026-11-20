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

**The final questions (2026-11-19):**

- **Dead and test-only code (P24): remove all of it** (items a to f). The owner will reimplement
  anything that turns out to be needed.
- **D1, one scorer: yes, if it's simpler.** Also, the MCP tools must not show scores or ranks: those
  make heuristics sound authoritative. The tools are idea generators that surface cards to
  consider, and their recommendations are often bad, so research and judgement matter. Tool output
  is designed to use few tokens.
- **D2, the type-line helper stays a plain function: yes.**
- **D3, the simulator: remove the interactive goldfish feature.**
  - Keep the server-side simulations that answer "can I cast X by turn Y?", with many runs: the
    opening-hand and cast-on-curve simulations behind `draw_sample` and the scorecard.
  - The plug-in structure was meant for cost reducers and rituals (such as Dark Ritual, which it
    doesn't handle today). Keep that extension point as a small registry of effects, and drop
    the injected options only tests use.
- **D4, advice splits into scoring and building: yes.**
- **D5, the rating weights were fitted from data.** The code says so, and names the script that fits
  them.

**The UI review's questions (2026-11-19), answered by approving the plan with the recommendations:**

- **Images:** keep plain `<img>` (the local image cache does the optimiser's job), behind one documented
  `CardImage` component.
- **Error pages:** simple custom `error`, `not-found` and `loading` pages.
- **Colours:** design tokens (`surface`, `muted`, `accent`, `danger`, …) in place of raw `zinc-*` classes.
- **Dark mode:** follows the system setting only; no toggle.

**The revised plan was approved on 2026-11-19.**

**Test layout (2026-11-19): as recommended.** A test lives with the module it covers, unit or
integration; `tests/` keeps only end-to-end specs, journeys across modules, fixtures and setup.
P20's step 6 does the move.

**P14's questions (2026-11-20):**

- Merge P14 after P13 and accept the small net growth that remains (P12's +42 less P14's −7).
- `blitz` in the deck profile reads Scryfall's keywords: accepted. To find enablers, P13 adds a
  `grants` recognizer and a `haste` theme (makes: grants haste; uses: haste or blitz creatures), so
  `theme:haste` and the deck tools find them. `o:` and `kw:` searches work as before.
- The "French vanilla" recognizer (doc 66 section 7) is dropped until a feature needs it.

**P15's differences (2026-11-20): accepted, as recommended.** Hybrid pips pay with either colour,
`{C}` needs a colourless source (and an unpayable one means not castable), pips are matched to
sources exactly, a bottomed card goes to the bottom of the library, a ramp card with no mana value
isn't early ramp, and half-mana symbols don't count as colour pips. **Creature types:** one
function, counting Kindred everywhere (the drafter's copy ignored it). Done in P28, after P27 frees
`suggest.ts`.
