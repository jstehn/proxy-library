# Design: card features (one model of what a card does)

- **Phase:** refactor package P11 (doc 65, F4 and D12; steps 2 to 4 are P12 to P14)
- **Status:** Accepted (user, 2026-11-19), with the answers in section 12. Steps 2 to 4 of P11 may start.
- **Related ADRs:** 0017, 0019 (this extends it), 0026, 0027 (the decision, short)
- **Lesson:** no (deferred, like the rest of the refactor: see `docs/refactor/STATUS.md`)

Measured on `refactor/main` at `38c360e`, 2026-11-19, against the dev database in `.dev/`.

## 0. The decision 3 finding: compute at sync, or on load?

You asked: look at where features are used. Many places, deck building included: compute at sync
and on update. Otherwise compute on load and cache.

**Where card text is turned into meaning today** (`grep` for the calls and for regexes on text):

| What it computes                                                                                      | Where                                                                                      | Who calls it                                                                                              | How often                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Role tags (7), themes (about 30), bracket flags                                                       | `shared/card-search/{tags,primitives,brackets}.ts`                                         | 23 files call it live: 13 in `decks/domain`, 4 queries, 2 application, 3 builder components, the sync     | every deck load, every builder render, every simulator start; **and** once per printing in the sync, stored (ADR 0019) |
| Stored copies: `printings.role_tags`, `theme_tags`, `bracket_flags`, `features_version`               | `catalog/infrastructure/schema.ts`; filled by `tagPass` in `catalog/application/sync.ts`   | 7 query files and `card-search/sql.ts` (`tag:`, `theme:`, `is:extraturn`): suggestions, mana base, search | per SQL query, whole catalog                                                                                           |
| Signals, kind 1: evidence counting (counters, tokens, creature types, triggers, phrases)              | `shared/card-search/signals.ts`                                                            | `deck-signals.ts` (LLM tool)                                                                              | per tool call                                                                                                          |
| Signals, kind 2: makes and uses (12 tags), scored                                                     | `decks/domain/signals.ts`                                                                  | ratings, cuts, suggestions, optimize, builder cuts panel (browser)                                        | per candidate card, per request                                                                                        |
| Mana production (`{T}: Add`, Tron, Temples, doublers), mana-source test                               | `decks/domain/mana.ts`, `castability.ts`                                                   | goldfish, castability, mana base                                                                          | per deck load; per simulated turn                                                                                      |
| Cast modifiers, zone permissions (Muldrotha, Mystic Forge), cascade, undying, haste, extra land drops | `decks/domain/sim-pipeline.ts` (20 regexes; `new RegExp` built inside per-check functions) | the goldfish game                                                                                         | **per game event**                                                                                                     |
| Cost reducer scopes, blitz                                                                            | `decks/domain/deck-profile.ts`                                                             | castability, draw sample                                                                                  | per card, per request                                                                                                  |
| Commander, partner, background, companion text; legendary/Vehicle/Conspiracy type checks              | `decks/domain/rules.ts`, `drafts/domain/abilities.ts`                                      | deck problems (browser and server), drafts                                                                | per deck check                                                                                                         |
| Land cycles (`is:shockland`, 14 more) in SQL regexes; "enters tapped" in TypeScript                   | `shared/card-search/sql.ts`; `decks/domain/mana-base.ts`                                   | search, mana base planner, castability                                                                    | per query / per land                                                                                                   |
| Card types (land, basic, creature) from the type line                                                 | `shared/kernel/card-types.ts` (P04)                                                        | 59 calls in 28 files                                                                                      | everywhere                                                                                                             |
| Reminder-text stripping                                                                               | `primitives.ts`, `signals.ts` (`plainText`), `sql.ts` (`REMINDER`), `embedding-text.ts`    | the above                                                                                                 | per card                                                                                                               |
| Which tokens a card makes                                                                             | **not text**: Scryfall's `all_parts` links (`token_links`), `token-proxies.ts`             | token proxies, checklist                                                                                  | per deck                                                                                                               |
| Draft abilities                                                                                       | **not text**: a table keyed by card name (`drafts/domain/abilities.ts`)                    | draft engine                                                                                              | per pick                                                                                                               |

**Size.** 87,773 printings, 33,479 oracle cards (2.6 printings per card), 2,065 multi-face
printings. One whole-catalog run of today's `cardTags` + `cardThemes` + `textBracketFlags` takes
**2.0 s** (58 µs a card); a 100-card deck's tags and themes take 5 ms. Card text is 7.9 MB in
all. So speed is not what decides this: either way would be fast enough today.

**What decides it.** (1) The rule you gave: features are used in 23 files, including deck
building, so they go stored. (2) The search language, suggestions and the mana base planner
filter **in SQL** over the whole catalog, which cannot call TypeScript. They already read stored
columns (ADR 0019). (3) The simulator hits text per game event; features parsed once at load
remove that. (4) Stored features have one known weakness, **staleness**, and this database shows
it: every printing is at `features_version` 1, the code is at 4, so `is:extraturn` finds nothing
here (0 rows have bracket flags). Section 8 keeps the stored choice and closes the gap.

**Choice: compute at sync and on update, store the result.** "On update" means: the nightly
sync, a version bump, and a lazy repair when a reader meets a missing or old row.

## 1. Purpose and scope

One pure function turns a card's printed faces into a versioned `CardFeatures` value. The
catalog stores it for every oracle card. Every consumer reads that value and none reads oracle
text. A new ability is a new **recognizer** (one regex in one file, with a fixture test), not an
edit in five files.

**P11 ships** the model, the recognizer registry, storage, `pnpm worker sync features`, the first
recognizer (`tap-mana`, which replaces the tap-for-mana code in `decks/domain/mana.ts` and
`castability.ts`), and the test pattern. There is **no faces-and-types recognizer**: P26 keeps
`cardTypes` as the pure type-line helper (owner answer D2), and the features carry oracle-text
facts only. Reminder-text stripping and name substitution (`plainText`) arrive with P13, which
deletes the copies in `tags.ts`, `primitives.ts` and `brackets.ts`; P11 has no recognizer that
needs them, so it ships no unused preprocessing. **P12** (mana, costs, casting, triggers), **P13**
(tags, themes, signals) and **P14** (lands, types, draft cards) add their recognizers and move
their consumers.

**Out of scope:** changing what any rule decides (the moved regexes stay identical; section 11);
the search language's grammar (ADR 0017); Scryfall data we already store as data (Game Changer
list, `keywords`, `all_parts`); deck-level scoring (ratings, cuts, the signal counting
across a deck stays in `decks`).

## 2. Ubiquitous language

| Term              | Meaning                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Card features     | The structured, versioned answer to "what does this card do?". One per oracle card.                               |
| Recognizer        | A pure `{ id, recognize }` that reads one card's text and fills some features. Owns its regexes.                  |
| Registry          | The ordered list of all recognizers (`RECOGNIZERS`). `extractFeatures(card)` runs it.                             |
| `featuresVersion` | One whole number. Bump it when any recognizer's output changes; the sync then recomputes every card.              |
| Feature field     | One named part of `CardFeatures` (`manaProduction`, `roleTags`, …). Each field has exactly one owning recognizer. |
| Plain text        | A face's rules text without reminder text, with its own name as `~`. Made once, here.                             |

## 3. Domain model

Lives in `src/modules/catalog/domain/features/` (pure; types exported through `catalog/index.ts`
and, type-only, `catalog/client.ts` so the browser never imports a recognizer).

```ts
/** What the recognizers read: the printed faces plus the few card-level facts Scryfall gives. */
export type CardText = Readonly<{
  oracleId: OracleId;
  faces: readonly CardFace[]; // the catalog's existing CardFace (name, manaCost, typeLine, text, …)
  keywords: readonly string[]; // Scryfall's keyword list
  producedMana: readonly ManaSymbol[]; // Scryfall's produced_mana
}>;

export type CardFeatures = Readonly<{
  featuresVersion: number;
  tapMana: TapMana; // P11 (shipped)
  manaProduction: readonly ManaProduction[]; // P12
  costChanges: readonly CostChange[]; // P12
  castPermissions: readonly CastPermission[]; // P12
  triggers: readonly TriggerFeature[]; // P12
  effects: readonly EffectPrimitive[]; // P13 (today's primitives: draw, removal, bounce, …)
  roleTags: readonly RoleTag[]; // P13
  themes: readonly Theme[]; // P13
  leaderThemes: readonly Theme[]; // P13: what it says when it leads a deck
  bracketFlags: readonly BracketFlag[]; // P13
  signals: readonly SignalFact[]; // P13
  landFeatures: LandFeatures | null; // P14
}>;
```

P11's `CardFeatures` has only `featuresVersion` and `tapMana`. **Each later package adds its fields to
this type in the same commit as its recognizer and bumps `featuresVersion`.** So nobody ever
reads an empty field that "will be filled later".

**Tap mana (P11, shipped).**

```ts
export type TapMana = Readonly<{
  isSource: boolean; // a {T} ability that adds mana, or Scryfall lists mana it produces
  amount: number; // mana added by one tap, 0 when it depends on the board (no battlefield here)
  requiresFiveLands: boolean; // "Activate only if you control five or more lands"
}>;
```

Moved unchanged from `decks/domain/mana.ts`: it reads the printed face text (not `plainText`),
as the old code did, so a Powerstone-making card's reminder text still counts. Reading
`plainText` is a later change with a version bump.

**Later fields (sketches; P12 to P14 finalize each union with their fixture cards).**

```ts
export type ManaProduction = Readonly<{
  cost: "tap" | "sacrifice" | "spell"; // {T}: Add; sacrifice a creature: Add; a ritual
  symbols: readonly ManaSymbol[]; // fixed mana, e.g. ["C", "C"]
  anyColor: boolean;
  condition: ManaCondition | null; // Temple of the False God, Urza's lands, Shrine
}>;
export type CostChange = Readonly<{
  kind: "reduceGeneric" | "increase" | "alternativeFree" | "blitz";
  amount: number;
  scope: CostScope; // today's COST_REDUCER_SCOPES
}>;
export type CastPermission = Readonly<{
  kind: "permanentFromGraveyardEachType" | "artifactOrColorlessFromLibraryTop" | "cascadeTwice";
  from: "graveyard" | "library" | "hand";
}>;
export type TriggerFeature = Readonly<{
  event: "enters" | "dies" | "attacks" | "landfall";
  effect: string;
}>;
export type SignalFact = Readonly<{
  kind: SignalKind; // counter, token, creatureType, keyword, trigger, cost, zone, …
  name: string; // "spore counter", "Saproling token"
  direction: "makes" | "uses" | "mentions";
}>;
export type LandFeatures = Readonly<{
  entersTapped: "never" | "sometimes" | "always";
  cycle: LandCycle | null; // shockland, fetchland, triome, …
}>;
```

The `RoleTag`, `Theme`, `BracketFlag` and `SignalKind` word lists (today `TAGS`, `THEMES`,
`BRACKET_FLAGS`, and their labels) move from `shared/card-search/tags.ts` to a new
`@/shared/kernel/card-vocabulary.ts`. The search parser needs them to check `tag:` and
`theme:`, and `shared/` may not import a module (ADR 0009); like `COLORS`, they are words every
module shares.

## 4. Invariants

1. **Pure and deterministic.** `extractFeatures(cardText)` does no I/O and reads no clock. The
   same input gives the same output; a test runs it twice.
2. **One owner per field.** Every `CardFeatures` field is written by exactly one recognizer.
   A registry test fails if two claim the same field or if an id repeats.
3. **One regex, one place.** A regex over card text exists only in
   `catalog/domain/features/recognizers/`. A lint rule enforces it (section 10).
4. **Reminder text is stripped once.** `plainText` is the only text recognizers read, except
   where a rule is about the printed reminder itself (named in that recognizer's comment).
5. **Moving is not fixing.** A recognizer moved from old code gives the **same answers** as the
   old function on every oracle card in the local catalog (the A2 test, section 11). A real
   improvement is a separate commit, with its own test and a version bump.
6. **The version rule.** Any commit that changes what `extractFeatures` returns for any fixture
   card also raises `FEATURES_VERSION`. A test enforces it (section 8).
7. **No empty promises.** A field exists in the type only once its recognizer is registered.
8. **Lands never get `ramp`** and a card can have several tags (doc 19, invariants 2).
   A card with a land on any face is a land (STATUS decision 1); `isLandOnFront` is for
   questions about the card on the table.
9. **Stored equals computed.** For any stored row at the current version,
   `row.features` equals `extractFeatures` run on the card now (an integration test samples
   200 cards).
10. **The `kw:` and Game Changer data stay data.** Game Changer status is never a feature
    (ADR 0019 note, doc 31 invariant 7).

## 5. Recognizers and the registry

```ts
/** One recognizer fills the fields it owns, from one card's text. */
export type Recognizer<Field extends keyof CardFeatureFields> = Readonly<{
  id: string; // "tap-mana", "muldrotha-permission"
  field: Field; // the one field it owns
  /** `earlier` holds the fields recognized before this one (roleTags read effects). */
  recognize(card: CardText, earlier: Partial<CardFeatureFields>): CardFeatureFields[Field];
}>;

export const RECOGNIZERS: readonly AnyRecognizer[] = [tapMana /* P11 */ /* P12 to P14 add */];

export function extractFeatures(card: CardText): CardFeatures {
  /* run RECOGNIZERS in order, collect each field, add featuresVersion */
}
```

`CardFeatureFields` is `CardFeatures` without `featuresVersion`. A recognizer returns its whole
field (an array, or a record) so several rules for one field live in one file as a named list,
the way `TAG_RULES` is today. Order matters only where one field reads another: effects before
role tags, tags and themes before signals. The registry's order says so, and a test asserts it.

Reminder text, name substitution and face joining are done **before** the recognizers run, in
`plainText` (P13). Recognizers run **per face** and merge (a card has the feature
if any face has it), except rules that name the front face (`isLandOnFront`). Open question 2.

Where a recognizer needs Scryfall's own facts (`keywords`, `producedMana`), `CardText` carries
them. That is how today's `mana_production` extractor works.

## 6. Ports

One new port in `catalog/application/ports.ts`, part of the catalog's capabilities (ADR 0026):

```ts
export interface CardFeaturesStore {
  /** Rows at the current version for these oracle ids; missing or old ones are not returned. */
  find(oracleIds: readonly OracleId[]): Promise<ReadonlyMap<OracleId, CardFeatures>>;
  /** Oracle cards with no row or an old one: their text, a batch at a time. */
  textsToCompute(version: number, limit: number): Promise<readonly CardText[]>;
  save(rows: readonly { oracleId: OracleId; features: CardFeatures }[]): Promise<void>;
}
```

`catalog.cardFeatures(oracleIds)` (a capability, `catalog/application/card-features.ts`) calls
`find`; for ids it did not get back it computes from the faces, saves, and returns them
(**lazy repair**). Decks, drafts and the LLM tools get features through this one function. No
module reads the table directly.

## 7. How each consumer moves

Each package moves its consumers **in the same commits as its recognizers**: change the
callers, delete the old function and its tests (playbook A4).

| Consumer today                                                                       | Recognizer(s) that replace it                                                   | Package    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------- |
| `kernel/card-types.ts` `cardTypes`, `isLand`, `isBasicLand`, `isCreature` (59 calls) | none: P26 keeps `cardTypes` pure                                                | P14        |
| `rules.ts` Legendary, Vehicle, Background, Conspiracy type checks                    | `cardTypes` (kernel, P26)                                                       | P14        |
| `deck-profile.ts` scope predicates on the type line (`Artifact`, `Enchantment`, …)   | `cardTypes` (kernel, P26)                                                       | P12        |
| `mana.ts` `hasTapManaAbility`, `extractTapManaProduction`, doublers                  | `tap-mana` (**shipped in P11**; the dead battlefield branches are deleted)      | P11        |
| `castability.ts` `isManaSource`, five-lands check; `mana-base.ts` `tapped()`         | `tap-mana`; `enters-tapped` (a land feature)                                    | P12, P14   |
| `sim-pipeline.ts` keyword checks, extra land drops, blitz, cascade, undying/persist  | `granted-keywords`, `extra-land-drops`, `cost-alternatives`, `death-return`     | P12        |
| `sim-pipeline.ts` Muldrotha, Mystic Forge, Ashnod's-style sacrifice mana             | `cast-permissions`, `sacrifice-mana`                                            | P12        |
| `deck-profile.ts` blitz; sim `explicitCostReduction`                                 | `cost-changes` (reads, does not replace, the deck plan; question 8)             | P12        |
| `tags.ts` `cardTags` and `primitives.ts` extractors                                  | one recognizer per extractor (14) into `effects`; `role-tags` from them         | P13        |
| `tags.ts` `cardThemes`, `leaderThemes`; `brackets.ts` text rules                     | `themes`, `leader-themes`, `bracket-text`                                       | P13        |
| `shared/card-search/signals.ts` per-card findings                                    | `signal-facts` (counting across a deck stays in `decks`)                        | P13        |
| `decks/domain/signals.ts` `cardSignalIO` makes/uses                                  | `signal-facts` (same recognizer, `direction`)                                   | P13        |
| `rules.ts` partner, background, companion, "can be your commander"                   | `commander-abilities`                                                           | P14        |
| `sql.ts` land cycles (`is:shockland` …), `FRENCH_VANILLA`                            | `land-cycle` (question 9)                                                       | P14        |
| `drafts/domain/abilities.ts`, `timers.ts` name check                                 | not a text recognizer: keyed by name; P14 keeps it as one data table            | P14        |
| `token-proxies.ts`                                                                   | not touched: it reads Scryfall links (question 7)                               | none       |
| `embedding-text.ts`, `compact-deck.ts` (strip reminders for display or embeddings)   | read `faces[].plainText`                                                        | P13        |
| Builder client (`deck-list.tsx`, `deck-builder.tsx`, `cuts-panel.tsx`)               | read `features` sent from the server; no recognizer ships to the browser        | P13        |
| Queries that glue faces with `string_agg(f->>'text', ' ' / E'\n' / '')` (12 copies)  | deleted: they ask `catalog.cardFeatures`; display text still comes from `faces` | P12 to P14 |

## 8. Persistence

**Table `card_features`** (owned by `catalog`), one row per oracle card, like `card_embeddings`:

```
oracle_id        text primary key
features         jsonb not null           -- the whole CardFeatures
features_version integer not null
role_tags        text[] not null default '{}'   -- GIN index, copied from features for SQL
theme_tags       text[] not null default '{}'   -- GIN index
bracket_flags    text[] not null default '{}'   -- GIN index
updated_at       timestamptz not null
index on features_version
```

The three arrays exist because the search language, suggestions and the mana base planner filter
with `role_tags && array[…]` (ADR 0019). They are written in the same statement as `features`
and are never read by TypeScript. Until P13 they stay empty here and the existing
`printings.role_tags`, `theme_tags`, `bracket_flags` and `features_version` columns keep working
unchanged, written by the old tag pass. **P13 moves the SQL to the new arrays (a join on
`oracle_id`) and drops the printings columns in one migration.** Question 1 asks whether to
store per oracle card (proposed) or keep ADR 0019's per-printing shape.

**Migration** `0050_card_features.sql`: creates the table and indexes; no data change.

**Backfill.** `pnpm worker sync features` runs a **features pass**: select oracle cards with no
row or `features_version < FEATURES_VERSION`, in batches of 500; run `extractFeatures`; save.
33,479 cards take about 2 s of recognizing plus the writes. The same pass is step 5c of every
nightly sync, after the Scryfall pass (it reads `producedMana` and `keywords`). It picks which
printing's text to use deterministically: the newest printing with text. The Docker
`migrate` step does not backfill; `docs/deploy.md` gets one line: after an update that bumps
the version, the next sync fills it, or run `pnpm worker sync features` now.

**The version rule.** `FEATURES_VERSION` lives in `catalog/domain/features/version.ts`. During P11
to P13 the old `CARD_FEATURES_VERSION` (in `tags.ts`) still governs the printings columns; P13
deletes it. To stop "changed a rule, forgot to bump": `tests/fixtures/features/golden.json`
holds the full `extractFeatures` output for every fixture card plus the version it was written
at. The golden test fails if the output changed while `FEATURES_VERSION` equals the stored
version, with a message saying to bump and regenerate (a regenerate script). This is the
mechanical answer to ADR 0019's staleness warning.

**Staleness while the pass has not run.** A reader that finds no row, or an old one, repairs
it on the spot (section 6), so a deploy that bumps the version never serves empty features. The
SQL filters are the exception: until the pass runs, `tag:` finds only cards already at the
current version. The sync summary reports `featuresComputed`.

## 9. Read models

Features reach consumers through `catalog.cardFeatures(oracleIds)`; deck queries add them to
their rows. A card's features are about 1 to 3 KB as JSON, so a 100-card deck adds well under
300 KB, and the builder gets tags, bracket flags and mana facts without running a recognizer in
the browser. The LLM tools' output stays the same (`docs/refactor/reference/tools/`). No
events are emitted.

## 10. Patterns applied

- **Functional core, plugin registry** (`patterns.md`: Open-Closed, as `sim-pipeline` and the
  effect extractors already do). Recognizers are the plugins; the list is data.
- **Factory-function DI** for the store, wired in `catalog/wiring.ts`; the recognizers are plain
  pure functions, no factory needed.
- **Anti-corruption** (ADR 0007) is unchanged: Scryfall and MTGJSON still enter through the
  gateways, Zod and mappers. `CardText` is built from our own `CardFace`s.
- **The guard** (playbook S3): `no-restricted-syntax` in `eslint.config.mjs`, for files outside
  `src/modules/catalog/domain/features/recognizers/` (tests excepted): a regex literal or
  `new RegExp` in the **argument or receiver of** `.test`, `.exec`, `.match`, `.matchAll`,
  `.replace` when the other side's member name is `text`, `oracleText`, `typeLine`, `plainText`
  or `faceText`. The message names `catalog.cardFeatures`. Exceptions list (with reasons) is short:
  the search parser (`o:` is the user's own pattern, not a card rule). P11 adds the rule
  with the **current offenders on an allowlist**; P12 to P14 each shrink it; it is empty after
  P14.
- **Deliberate deviation:** ADR 0019 stored features per printing in the `printings` table. This
  design stores per oracle card in its own table (reason: text is per oracle card; 2.6 times
  less to compute and store; `card_embeddings` is the precedent).

## 11. Test plan

**Per recognizer** (the pattern P12 to P14 copy). `recognizers/<id>.test.ts` is a table over
**real card text** from `tests/fixtures/features/cards.json`, with near-misses that must not
match:

```ts
it.each([
  {
    card: "Sol Ring",
    expected: [{ cost: "tap", symbols: ["C", "C"], anyColor: false, condition: null }],
  },
  { card: "Llanowar Elves", expected: [/* tap, G */] },
])("tap-mana reads $card", ({ card, expected }) => {
  expect(tapMana.recognize(fixture(card), {})).toEqual(expected);
});
it.each(["Dark Ritual", "Wrath of God"])("tap-mana ignores %s", (card) => {
  /* … */
});
```

The fixture file is real Oracle data (name, faces, keywords, produced mana) from Scryfall's
oracle cards: about 120 cards chosen across the abilities, plus the cards today's tests already
quote. It gets a row in `tests/fixtures/README.md`; no test touches the network. Each recognizer
adds its cards.

- **The A2 test (moves, not fixes).** Before an old function is deleted, a test feeds it and the
  new recognizer every fixture card and compares. A one-off script does the same over all
  33,479 cards in the local database; the disagreement count goes in the package's handoff.
- **Registry tests.** Unique ids; one owner per field; field order (effects before tags before
  signals); every `CardFeatures` field has a recognizer (invariant 7); two runs are equal
  (invariant 1).
- **Golden and version test** (section 8).
- **Use cases (fakes).** `catalog.cardFeatures`: a hit returns the stored value; a miss
  computes, saves and returns; an old row is recomputed. `FakeCardFeaturesStore` joins the
  kernel's `testing`.
- **Integration** (`pnpm test:int`, run by the reviewer): the migration applies; the features
  pass fills the fixture database and a second run computes 0; stored equals computed for a
  sample; a version bump recomputes everything.
- **E2E:** none for P11 (the player sees no change). P12 to P14 re-run the simulator and builder
  e2e tests.

## 12. Open questions

**Answered by the user, 2026-11-19:**

| #   | Question           | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Storage            | **One row per oracle card** (a). Checked first: rules text, type lines, produced mana, keywords and Game Changer status never differ between printings of one card in the dev catalog; the only cards with two text variants (17) are `reversible_card` printings that repeat the same card on both sides (Command Tower, shocklands, basics, a few Tarkir: Dragonstorm promos). The recognizer reads the card's non-reversible printing, or one side of a reversible one. Printings, prices, art, finishes and legalities (which do differ for 539 cards) stay per printing. Nothing a player sees is lost. |
| 2   | Two-face cards     | (a) Recognize each face and merge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3   | Ramp               | (a) One `ramp` tag, plus a separate feature for mana sources you tap (`isManaSource`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 4   | Rituals            | (a) Rituals count as ramp.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 5   | Keywords           | (a) Scryfall's keyword list; granting abilities is a separate recognizer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6   | Signals vocabulary | (a) Themes are the vocabulary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 7   | Tokens             | (a) Keep both sources, named differently.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 8   | Cost reducers      | (a) Declared and recognized both count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 9   | Land cycles        | (a) A `land-cycle` recognizer and a stored `land_cycles` array.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 10  | Phrase mining      | (a) Reads `faces[].plainText` from features.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The original questions follow, for the record.

For you to decide. Each is a place where today's code disagrees with itself, or where two docs
conflict. The moved code keeps today's behavior until you answer; the answer is a later, tested
commit.

1. **Where features are stored.** (a) One row per **oracle card** in a new `card_features` table
   (proposed): text is per oracle card, 33,479 rows against 87,773, and decks already look
   cards up by oracle id. SQL filters join on `oracle_id`. (b) Keep ADR 0019's shape: a `jsonb`
   column on **printings** plus the arrays there: no join, but 2.6 times the work and storage and
   the copies can disagree between reprints. This reverses a rejected alternative in ADR 0019
   ("a separate table adds a join"), so it is your call.

2. **Double-faced and split cards: one text or each face?** Faces are joined three ways today:
   `' '` (the sync and 8 queries), `'\n'` (`search-for-deck`, `card-facts`, `sql.ts`) and `''`
   (`sql.ts` `RULES_TEXT`). So a `[^.]*` rule can match across faces in one place and not in
   another, and the **stored** tags of a two-face card can differ from the ones the builder works
   out live. (a) Recognize each face alone and merge: a card has a feature if any face does
   (proposed; exact for "Instant // Land"). (b) Join with `'\n'` everywhere and keep the rules as
   they are. (a) can change tags on some of the 2,065 two-face printings; the A2 test lists
   which before you accept it.

3. **What is "ramp"?** Four definitions today. The `ramp` **tag** (`tags.ts`): makes mana, or
   fetches a land to the battlefield, or extra land play, or puts a land from hand, or makes a
   Treasure; never on a land; no mana value limit. **Castability** (`isManaSource`): not a land,
   mana value 4 or less, and `{T}…Add {`: rocks and dorks only. **Early ramp** (goldfish,
   mulligan trainer, `draws.ts`): the tag **and** mana value 3 or less. The **signal**
   `landfall_ramp`: land fetch and extra land plays (plus a separate `treasure` signal). The
   search aliases `mana-rock`, `mana-dork` and `land-ramp` all mean `tag:ramp`. Options: (a) one
   `ramp` tag, plus a separate feature `isManaSource` (rocks and dorks that tap), and the mana
   value limits stay as each consumer's own number (proposed; changes nothing visible);
   (b) split the tag into kinds (`rock`, `dork`, `landFetch`, `treasure`), with `ramp` meaning
   any, so `land-ramp` and `mana-rock` finally differ; (c) make all consumers use the tag,
   which makes castability count land-fetch spells as ramp.

4. **Is a ritual a mana source?** `producedMana` (Scryfall) includes spells like Dark Ritual, so
   the tag calls them ramp; `{T}: Add` rules do not. (a) Keep it: ramp includes rituals; tapping
   sources are a separate feature (follows from 3a). (b) Rituals are not ramp.

5. **Keywords: Scryfall's list or the text?** The simulator finds `haste`, `vigilance`,
   `defender`, `undying`, `persist`, `cascade` and `blitz` with `\bkeyword\b` on the text, which
   also matches "creatures lose haste" and reminder text; the catalog already stores Scryfall's
   `keywords` for `kw:`. (a) Keyword on the card itself comes from Scryfall's list; granting
   ("equipped creature has haste") is a separate recognizer (proposed). (b) Keep the text match.

6. **One signals vocabulary: whose names survive?** `shared/card-search/signals.ts` names
   evidence (`spore counter`, `Saproling token`, `dies trigger`, phrases); `decks/domain/signals.ts`
   has 12 fixed tags (`plus_one_counter`, `landfall_ramp`, `blink_etb`, …) with labels shown in
   ratings; themes (about 30) overlap both (`counters`, `treasures`, `landfall`, `graveyard`,
   `lifegain`). One model needs one name per idea. (a) Themes are the vocabulary; the 12 tags
   become `makes`/`uses` of themes; ratings show theme labels (proposed; the wording of
   ratings and tool output changes slightly). (b) The 12 tags are the vocabulary and themes
   derive from them. (c) Keep two lists in one model. P13 brings a side-by-side table either way.

7. **Which tokens does a card make?** Three answers: text recognizers (the `create_token`
   effect and the `tokens`/`treasures`/`creature-tokens` themes), signal names from text
   (`Saproling token`), and Scryfall's `all_parts` links that token proxies print from (art ids,
   per printing). They can differ (a "copy of" token, a card that makes a token by name only in
   its reminder). (a) Keep both: text features say what a deck **plays into**; Scryfall links say
   what to **print**; name them differently (proposed). (b) Make token proxies fall back to text
   when a card has no link.

8. **Cost reducers: recognized, or declared?** A deck's plan (`DeckPlan.costReducers`) is
   written by the player or the LLM ("Henzie reduces by 1 per command cast"); the card text is
   not read. The new `costChanges` feature would say what a card's **text** does, so the two
   can disagree (a reducer declared for a card that has none, or a missing one). (a) Keep the
   plan as the player's statement; the simulator uses declared reducers and recognized ones
   (proposed). (b) The plan wins, recognized ones
   are only a suggestion in the UI. (c) Replace declared reducers with recognized ones.

9. **Land cycles in search.** `is:shockland` and 14 more are Postgres regexes in `sql.ts`
   (doc 28 section 3.6); "enters tapped" is a TypeScript regex in `mana-base.ts`, and another
   copy in SQL. ADR 0017 keeps `sql.ts` free of card rules. (a) A `land-cycle` recognizer fills
   `LandFeatures.cycle`; a stored `land_cycles` array replaces the regexes, and `is:shockland`
   becomes a column filter (proposed; adds a fourth GIN array and a P14 migration). (b) Keep SQL
   regexes but import their pattern strings from the recognizer file, so each pattern is still
   written once.

10. **Phrase mining reads text.** The "recurring phrases" signal finds 2 to 4 word phrases that
    several cards share; it needs text and is not a recognizer. (a) It reads `faces[].plainText`
    from features (one exception to "no consumer reads text", documented and allowed by the
    lint rule; proposed; about 8 MB of plain text in the table). (b) Store the phrases (about
    100 per card: much bigger). (c) Drop phrases from the signals and keep only named signals
    (that would be a feature cut; not proposed).
