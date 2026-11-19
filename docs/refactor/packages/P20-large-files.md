# P20. Responsibility check for the other modules; remaining large files

- **Branch:** `refactor/P20-large-files` · **Depends on:** P18 · **Parallel with:** P21
- **Audit:** the 500-line benchmark (README, "File size")
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S10](../dedup-playbook.md#s10) (small clones no package owns) · **Lines to remove:** about −100 to −200

## Goal

Every file still on `docs/refactor/oversize-allowlist.txt` with "pre-refactor" is split, or kept
with a real reason.

## Touches

Whatever is left on the allowlist. Likely: `drafts/domain/{steps,draft}.ts` (815, 707),
`drafts/application/drafts.ts` (672), `app/drafts/[id]/page.tsx` (654), `store/queries/store.ts`
(630), `shared/card-search/{parse,sql}.ts` (716, 615), `drafts/infrastructure/drizzle-draft-repository.ts`
(556), `reddit/infrastructure/reddit-http-gateway.ts` (553),
`catalog/infrastructure/drizzle-repositories.ts` (511).

## Steps

1. For every other module (`catalog` first, then `drafts`, `store`, `accounts`, the rest), check
   that it has one responsibility: no layer folder over about 12 files, and an `index.ts` under
   150 lines. Where a module holds two, propose the split to the user and do it, one module per
   commit. Group `reddit` and
   `youtube` under one `research/` module, each as a subfolder with its own layer folders.
2. For each file, name its jobs in one line each. A file with one job and a good reason to be long
   (a parser, a lookup table) stays, with that reason on the allowlist.
3. Split the others by job, not by line count: one module per job, each with its own tests.
4. The drafts steps engine (`steps.ts`, 65 uses of `ctx`) can split into one file per step kind,
   following the `DRAFT_ABILITIES` style.

## Done when

- The allowlist has no "pre-refactor" entries. No folder has more than 12 source files, and no
  `index.ts` is over 150 lines.
- STATUS's size tracking shows source lines at or under the target (or the gap is explained).

## Handoff

(empty)
