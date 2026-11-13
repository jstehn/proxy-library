# ADR 0025: Commander Spellbook Combo Data

- **Date:** 2026-11-13
- **Status:** Accepted
- **Related:** [Design 31 (Commander brackets)](../design/31-commander-brackets.md), [Design 52 (Two-card combos in the bracket estimate)](../design/52-two-card-combos-in-bracket-estimate.md), [ADR 0007 (External data behind an ACL)](0007-external-data-behind-acl.md)

## Context

`estimateBracket` previously marked `"combos"` as `unchecked` because neither card oracle text nor Scryfall flags can reliably detect two-card infinite or game-winning combos (for example, _Thassa's Oracle + Demonic Consultation_ or _Kiki-Jiki, Mirror Breaker + Zealous Conscripts_).

Commander Spellbook maintains an open, curated catalog of Commander combos with card oracle IDs, produced effects, mana requirements, and bracket classification tags (`bracketTag`) via its bulk JSON endpoint (`https://json.commanderspellbook.com/variants.json`).

## Decision

1. **Sync in the worker via `catalog`:** Add `SpellbookGateway` behind an anti-corruption layer in `catalog/infrastructure/` and a scheduled/manual worker job (`syncSpellbookCombos`) that fetches Commander Spellbook's bulk `variants.json` feed, filters to Commander-legal two-card combos with concrete `oracleId`s, and upserts them into Postgres (`spellbook_two_card_combos`).
2. **Read from Postgres only:** Request handlers, `decks` queries, and MCP tools read `spellbook_two_card_combos` via `decks` queries—never calling Commander Spellbook at request time.
3. **Map `bracketTag` + mana value in domain:** A pure domain mapper (`twoCardComboBracket`) maps Spellbook's `bracketTag` (`R` → Bracket 4, `S`/`P`/`C` → Bracket 3) with a mana-cost fallback (`manaValue <= 6` → Bracket 4 for early-game two-card combos, `>= 7` → Bracket 3 for late-game combos). Per Wizards' Commander bracket rules, any two-card infinite/game-winning combo forces at least Bracket 3.

## Consequences

- **Positive:** `estimateBracket`, `bracketWarning`, `fitsTarget`, `get_deck`, and the deck builder UI gain accurate two-card combo detection with zero runtime external dependencies.
- **Negative:** Adds a periodic bulk JSON sync (~tens of MB) in the worker and one Postgres table (`spellbook_two_card_combos`). If the table is empty (fresh DB before sync), `estimateBracket` still works gracefully and keeps `"combos"` in `unchecked` when no combo catalog is available, or reports 0 combos once synced.
