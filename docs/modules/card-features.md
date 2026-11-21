# Card features: what a card does

One versioned `CardFeatures` model per card (role tags, themes, makes/uses signals, bracket flags,
mana and casting facts, grants, land checks), built by small recognizers over the card's text and
stored at sync. Every consumer (deck stats, suggestions, search, the simulator, the bracket
estimate, the drafter) reads it; none parses oracle text itself. Code:
`src/modules/catalog/domain/features/` (ADR 0027, ADR 0019). Checked against `refactor/main`
(2026-11-20) by the tests named in brackets. The design is doc 66, which stays the reference for
fields and recognizers; this page holds the rules a player or reviewer would notice.

## The model

1. **Pure and deterministic:** `extractFeatures(cardText)` does no I/O and reads no clock; the same
   text gives the same answer twice. (doc 66 §4 rule 1; `registry.test.ts`)
2. **One owner per field:** every `CardFeatures` field is written by exactly one recognizer, ids are
   unique, and the registry fills every field and stamps the version. (doc 66 §4 rule 2, rule 7;
   `registry.test.ts`)
3. **One regex, one place:** regexes over card text live only in
   `catalog/domain/features/recognizers/` (lint rule; `pnpm regex-count` counts what is left outside).
   (doc 66 §4 rule 3, P11; `regex-count.test.ts`)
4. **Reminder text is stripped once** (`plainText`); recognizers read plain text, except where a rule
   is about the printed reminder itself. (doc 66 §4 rule 4, P13)
5. **Stored per oracle card at sync and on update,** and worked out again when a card's stored
   version is older than `FEATURES_VERSION` (`pnpm worker sync features` does only this). Any change to
   what a recognizer returns bumps `FEATURES_VERSION`. (doc 66 §0 and §4 rules 5-6, ADR 0027;
   `card-features.test.ts`) This replaces doc 20 decision 1 (features per printing).
6. **Game Changer status is data, not a feature:** it comes from Scryfall's flag, never a list in our
   code. (doc 66 §4 rule 10, doc 31 §4 rule 7)

## Roles, themes and signals

7. **One tag table.** Role tags are ramp, draw, removal, wipe, counter, tutor and protection
   (`TAGS`); statistics, the deck list and the selected card all read the same tags; a card can have
   several or none; tags never change what a deck allows. (doc 19 §4 rule 1 and 2, §13.1 as extended;
   `role-tags.test.ts`)
8. **Lands never get `ramp`;** a card with a land on any face is a land. (doc 19 §4 rule 2, doc 66 §4
   rule 8; `role-tags.test.ts`)
9. **Every tag, theme and bracket flag has a real card that matches and a near-miss that does not,**
   with real Oracle text quoted in the test. Themes: every theme in `THEMES` leads somewhere in the
   examples, has a label, and umbrella themes include their sub-themes (treasures within
   artifact-tokens within tokens; goad, voting, group-hug and monarch within politics). (doc 19 §4 rule
   3, doc 38 §6; `role-tags.test.ts`, `themes.test.ts`, `bracket-flags.test.ts`)
10. **Statistics count copies in the main deck and commander, never the sideboard,** the same as every
    other statistic. (doc 19 §4 rule 4; `stats.test.ts` in `decks/core`)
11. **Role targets and role gaps follow the format** (see `decks-core.md` rule 11). (doc 19 §13.2)
12. **Haste:** a `grants` recognizer and a `haste` theme (makes: grants haste; uses: haste or blitz
    creatures) let `theme:haste` find enablers; `o:` and `kw:` work as before. The "French vanilla"
    recognizer is dropped until a feature needs it. (owner answers, P14, 2026-11-20; `grants.test.ts`)

## Bracket flags

13. **Text flags are land denial and extra turns** (Blood Moon and Back to Basics count as land denial,
    with the Armageddon and Winter Orb families); reminder text is ignored; a card can carry several
    flags in a fixed order. (doc 31 §13.2, doc 66 §3; `bracket-flags.test.ts`) What each flag forces
    is in `decks-core.md` rule 28.

## Land and casting facts

14. **Mana and casting facts come from the same model:** what a card does when tapped for mana
    (`tapMana`), whether a land enters tapped (`entersTapped`, conditional ones noted), and whether a
    spell puts a land onto the battlefield (`landFetch`). The simulator's effect registry reads these
    instead of a name list where it can. (P12-P14, P28b handoffs; `tap-mana.test.ts`,
    `enters-tapped.test.ts`, `land-fetch.test.ts`)
15. **Each land-cycle `is:` value matches its cycle and only it** (real cards plus near-misses, such as
    a check land not matching `is:fastland`). (doc 28 §4 rule 17; `land-cycles.test.ts`)

## Open decisions (found while writing this page)

- Doc 66 §4 rule 6 says a test enforces the version bump when a recognizer changes a fixture card's
  answer; no such test was found, only the re-extraction when a stored version is older. Not listed as
  a rule above.
- Doc 66 §4 rule 9 (an integration test samples 200 stored cards against `extractFeatures`) was not run
  here (integration tests are out of scope for P22).
