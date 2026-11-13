# Design: Round-trip `#Tag` / `[Category]` headings, reusable card packages, and mulligan trainer / scorecard

- **Phase:** 59
- **Status:** **Approved** (2026-11-13)
- **Related ADRs:** 0001 (modular monolith), 0006 (CQRS-lite reads), 0008 (injected RNG and clock), 0016 (client-safe module API), 0022 (LLM tool API), 0023 (process sized to feature)
- **Lesson:** no

## 1. Purpose & scope

Implement the three Tier 3 deck-building workflows:

1. **Round-trip `#Tag` and `[Category]` headings (`#163`):** Extend `parseList` and `list-format.ts` so Moxfield `#Tag` and Archidekt `[Category]` syntax map cleanly to deck headings (and optional line notes), and add a Moxfield-tag exporter.
2. **Reusable card packages (`#164`):** Let players save and apply named 6–12 card themed bundles (e.g., _"Sultai self-mill"_, _"Sacrifice outlets"_) across decks while respecting format legality, color identity, singleton/copy limits, and `usesRealCards` ownership reporting.
3. **Interactive mulligan trainer & shareable deck scorecard (`#165`):** Add a pure keep-or-mulligan drill evaluator built on `goldfish.ts` / `draws.ts`, and a shareable deck scorecard read model + public `/d/[token]/scorecard` route.

## 2. Domain & persistence design

### 2.1 Round-trip `#Tag` and `[Category]` headings

- **`src/shared/card-search/list.ts`:**
  - Add `tags: readonly string[]` to `ListLine` (always present, `[]` when none).
  - Extract trailing Moxfield `#Tag` tokens (e.g. `#Ramp`, `#Mana_Fixers` → `"Mana Fixers"`) and Archidekt `[Category]` / `[Tag1, Tag2]` tokens (ignoring `{top}` / `{noDeck}` modifiers) before parsing quantity/name/set.
  - When `heading === null` on `"main"`, promote the first non-board tag to `heading` (unless `isReservedTitle`).
- **`src/modules/decks/domain/list-format.ts`:**
  - Add `exportWithTags(lines, headings)` (and `EXPORTERS.moxfieldTags`) that writes main-deck lines with `#Heading` (spaces turned to `_`) so exporting and re-importing via `parseList` preserves headings 1-to-1.

### 2.2 Reusable card packages

- **Persistence (`src/modules/decks/infrastructure/schema.ts`):**
  - `card_packages`: `id`, `owner_id`, `name`, `description`, `color_identity` (`text[]`), `tags` (`text[]`), `created_at`, `updated_at`.
  - `card_package_entries`: `(package_id, oracle_id)` PK, `quantity`, `heading` (nullable), `note` (nullable).
- **Domain & Application (`domain/packages.ts`, `application/packages.ts`):**
  - Pure `planPackageInsert(packageEntries, existingDeckLines, format)` returns which cards to add, which are already present (skipped or incremented respecting copy limits), and which are blocked by color identity / format legality.
  - Use cases (`createPackage`, `deletePackage`, `applyPackageToDeck`) + MCP tools (`list_packages`, `create_package`, `apply_package`).

### 2.3 Mulligan trainer & shareable scorecard

- **Domain (`domain/mulligan-trainer.ts`):**
  - Pure `dealMulliganDrill(library, { rng, mulliganNumber, freeMulligan })` deals a 7-card hand and computes `evaluateMulliganDecision(hand, library, mulliganNumber, decision)` comparing the player's `"keep"` / `"mulligan"` choice against heuristic keepability (land count 2–5, early play <= 2 MV, color coverage) and returning a clear explanation.
- **Queries & UI (`queries/scorecard.ts`, `src/app/d/[token]/scorecard/page.tsx`):**
  - `deckScorecard(db, deckId)` aggregates `scoreDeck`, `auditDeck` summary (bracket + reasons, role coverage, goldfish keepable %, cast-on-curve %), and top strengths/weaknesses for both signed-in owners and public `/d/[token]/scorecard` links.

## 3. Invariants

1. **List round-trip:** Writing a deck with `exportWithTags` and reading it back with `parseList` preserves every card's `quantity`, `name`, `board`, and `heading`.
2. **Package safety:** `applyPackageToDeck` never violates format copy limits or color identity; incompatible cards are skipped with reasons rather than silently inserted.
3. **Deterministic drills:** `dealMulliganDrill` uses injected `Rng` (ADR 0008).

## 4. Test plan

- Unit tests: `list.test.ts` (`#Tag`, `[Category]`, round-trip), `list-format.test.ts` (`exportWithTags`), `packages.test.ts`, `mulligan-trainer.test.ts`.
- Integration & registry checks: `direnv exec . pnpm check` after each part.
