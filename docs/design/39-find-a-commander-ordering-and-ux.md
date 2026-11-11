# Design: Find a commander UX, theme/tribe filtering, and ordering heuristics

- **Phase:** 39 (tududi tasks `#137` and `#109`, project "Build decks from owned cards")
- **Status:** **Approved** (2026-11-11)
- **Related:** design doc 19 (role tags), design doc 20 (themes & card strength), design doc 31 (Commander brackets & Game Changers), design doc 36 (`commanders_i_can_build`), design doc 38 (32 themes with token and politics umbrellas). No new ADR: `edhrec_rank` comes from the existing Scryfall `default_cards` bulk file (ADR 0007), and ranking remains a pure function in `src/modules/decks/domain/commanders.ts`.
- **Lesson:** no.

## 1. Purpose & scope

Phase 36 introduced **Find a commander** (`/decks/commanders` and `commanders_i_can_build`), which ranks legends by how much of a 99-card deck your owned cards already cover. Playing with it surfaced three gaps:

1. **You can't read what a commander does on the page (`#137`).** Each row shows a small thumbnail and the extracted `Leads:` summary (`"Leads: Tokens, Treasures"`), but not the commander's actual type line or Oracle text, and hovering the thumbnail doesn't enlarge the card.
2. **You can't filter by theme or tribe (`#109`).** With 32 themes now in `THEMES` (including `politics`, `goad`, `voting`, `group-hug`, `monarch`, `each-opponent`, `tokens`, `creature-tokens`, `artifact-tokens`, `treasures`, `food`, `clues`, `blink`, `wheels`, `clones`, `theft`, `planeswalkers`, `legends`, `exile`, `extra-combat`, `stax`, `poison`, `vehicles`), a player or LLM agent needs to ask _"Which politics or Treasure commanders can I build?"_ or _"Which Elf commanders can I build?"_ without scanning hundreds of rows.
3. **Collection coverage is the only ordering (`#109`).** Coverage alone ranks 1-color vanilla legends above iconic 3-color commanders because 1-color decks need fewer lands and share generic staples. Players and agents also want to sort or blend by **popularity** (how widely played the card is on EDHREC, via Scryfall's `edhrec_rank`), **power / card strength** (Wizards' Game Changer status + card strength heuristic), or a **combined** blend of coverage + popularity + power — with clear disclaimers that every ordering is a starting-point heuristic, not a verdict or tournament win rate.

## 2. Scryfall `edhrec_rank` in the catalog (`printings.edhrec_rank`)

Scryfall's daily `default_cards` bulk file (already streamed by `ScryfallGateway` every night) includes `edhrec_rank: number | null` on each card object (lower rank = more decks on EDHREC; `#1` is Sol Ring).

- **ACL (`src/modules/catalog/infrastructure/scryfall.ts`):** Parse `edhrec_rank: z.number().int().positive().nullable().optional()` in `ScryfallCardSchema` and map to `edhrecRank: number | null` on `ScryfallCard` and `CardExtras`.
- **Database (`drizzle/0036_printing_edhrec_rank.sql` & `src/modules/catalog/infrastructure/schema.ts`):** Add `edhrec_rank integer` (nullable) to `printings`, updated in `saveCardExtras` alongside `is_game_changer`.
- **Reuse for Task `#59`:** Having `edhrec_rank` on `printings` also gives Phase 40+ (`#59`, quality prior in suggestions/draft) an offline popularity signal without touching the catalog schema again.

## 3. Domain model (`src/modules/decks/domain/commanders.ts`)

### 3.1 Candidate & coverage fields

Add `manaCost: string | null`, `rarity: string`, `roles: readonly Tag[]`, and `edhrecRank: number | null` to `CommanderCandidate`:

```ts
export const COMMANDER_SORTS = ["coverage", "popularity", "power", "combined"] as const;
export type CommanderSort = (typeof COMMANDER_SORTS)[number];

export type RankCommandersOptions = Readonly<{
  sort?: CommanderSort;
  /** Keep only commanders whose plan.themes includes this theme. */
  theme?: Theme;
  /** Keep only commanders whose plan.tribes or own creature types include this tribe (case-insensitive). */
  tribe?: string;
}>;
```

Add `powerScore: number` and `combinedScore: number` to `CommanderCoverage`:

- **`coverage.score` (Collection coverage, max ~122):**
  $$\text{coverageScore} = 2 \cdot \min(\text{onPlan}, 30) + 1 \cdot \text{roleCoverage} + 0.5 \cdot \text{filled}$$
- **`popularityBonus(edhrecRank)` (0 to 25 points):**
  When `edhrecRank !== null`, maps $\log_{10}(\text{edhrecRank})$ from $[1, 4.5]$ onto $[25, 0]$:
  $$\text{popularityBonus} = \max\!\left(0,\; \min\!\left(25,\; 25 \cdot \left(1 - \frac{\log_{10}(\max(10, \text{edhrecRank})) - 1}{3.5}\right)\right)\right)$$
  (Rank $\le 100 \implies \approx 18\text{–}25$ pts; Rank $1{,}000 \implies \approx 11$ pts; Rank $10{,}000 \implies \approx 3.5$ pts; Rank $\ge 31{,}600$ or `null` $\implies 0$ pts.)
- **`powerScore` (Card power heuristic, 0 to ~40 points):**
  Combines Wizards' Game Changer designation, the card-strength heuristic (`strength` from `suggest.ts`), command-zone role & mana-value efficiency (`roleBonus = min(4, roles.length * 2)`, `efficiencyBonus` up to `+3` for MV $\le 3$), how many distinct themes/tribes the commander's text drives (`planRichness = min(6, plan.themes.length * 2 + plan.tribes.length * 2)`), and `0.4 * popularityBonus(edhrecRank)`:
  $$\text{powerScore} = (\text{isGameChanger} ? 12 : 0) + 2 \cdot \text{strength}(\text{commander}) + \text{roleBonus} + \text{efficiencyBonus} + \text{planRichness} + 0.4 \cdot \text{popularityBonus}(\text{edhrecRank})$$
- **`combinedScore` (Blend of collection coverage + popularity + power):**
  $$\text{combinedScore} = \text{coverageScore} + \text{popularityBonus}(\text{edhrecRank}) + 0.5 \cdot \text{powerScore}$$

### 3.2 Filtering & sorting in `rankCommanders`

1. **Theme filter (`options.theme`):** Keeps candidates where `coverage.plan.themes.includes(options.theme)`. Because umbrella themes (`tokens`, `artifact-tokens`, `politics`) are included in `leaderThemes` whenever a sub-theme matches, filtering by `theme: "politics"` finds `goad`, `voting`, `group-hug`, `monarch`, and general politics commanders; filtering by `theme: "voting"` narrows to voting commanders.
2. **Tribe filter (`options.tribe`):** Case-insensitive match against `coverage.plan.tribes` **or** `creatureTypes(commander.typeLine)` (so searching `"Elf"` finds both _Ezuri, Renegade Leader_ and legendary Elves whose text leads another plan).
3. **Sort order (`options.sort`, default `"coverage"`):**
   - `"coverage"`: `b.score - a.score`, then owned first, then `edhrecRank` ascending (`null` last), then name.
   - `"popularity"`: `edhrecRank` ascending (`null` last), then `b.score - a.score`, then owned first, then name.
   - `"power"`: `b.powerScore - a.powerScore`, then `b.score - a.score`, then `edhrecRank` ascending, then name.
   - `"combined"`: `b.combinedScore - a.combinedScore`, then owned first, then `edhrecRank` ascending, then name.

## 4. Web UI (`/decks/commanders`)

1. **Commander Oracle text & hover preview (`#137`):**
   - Wrap the commander thumbnail on `/decks/commanders` in a hover/focus preview (`CommanderThumbnail` client component or `NamePreview`) that opens a full-size `/api/images/${commander.printingId}/normal/front` preview beside the card when hovered or focused.
   - Display `commander.typeLine` (with mana cost if present) and `commander.text` (rendered paragraph-by-paragraph with `<ManaText />`) directly inside each `CommanderRow` so you can read what every commander does without clicking away.
   - Show an `EDHREC #<rank>` badge next to the commander's name when `commander.edhrecRank !== null`.
2. **Filter & sort controls (`#109`):**
   - **Order by (`sort`):** Select dropdown with:
     - `Cards I own (coverage)` (`coverage`, default)
     - `Blend: coverage + popularity + power` (`combined`)
     - `Popularity (EDHREC rank)` (`popularity`)
     - `Power heuristic (Game Changer & card strength)` (`power`)
   - **Theme (`theme`):** Select dropdown with `"Any theme"` plus all 32 themes from `THEMES` using `THEME_LABELS`.
   - **Tribe (`tribe`):** Text input (`placeholder="Tribe (e.g. Elf, Dragon)"`).
   - **Clickable plan pills:** Each theme or tribe in a commander's `Leads:` line links to `/decks/commanders?theme=<theme>` or `/decks/commanders?tribe=<tribe>` so clicking a theme/tribe filters the list immediately.
   - **Heuristic disclaimer:** The page header and sort explanations state plainly that coverage, popularity (`edhrec_rank`), and power are starting-point heuristics over rules text and Scryfall bulk metadata, not win rates or deck-quality verdicts.

## 5. LLM tool (`commanders_i_can_build`)

Extend `commanders_i_can_build` in `src/app/_llm-tools/tools/decks.ts`:

- New optional input fields:
  - `theme?: string` — any theme name or `otag:` alias (resolved via `canonicalTheme(input)` from `src/shared/card-search`, e.g., `"politics"`, `"voting"`, `"treasures"`, `"artifact-tokens"`, `"blink"`). Returns a friendly error listing valid themes if unrecognized.
  - `tribe?: string` — creature subtype filter (e.g., `"Elf"`, `"Dragon"`).
  - `sort?: "coverage" | "popularity" | "power" | "combined"` (default `"coverage"`).
- Output additions per commander row:
  - `typeLine`, `text` (Oracle text), `edhrecRank`, `powerScore`, `combinedScore`, and a top-level `heuristicNote` reminding the agent and user that these rankings are starting-point heuristics requiring investigation.

## 6. Tests

1. **Unit tests (`src/modules/decks/domain/commanders.test.ts`):**
   - Theme filtering (including umbrella theme `politics` matching a `voting` commander, and specific sub-theme `voting` excluding a `goad`-only commander).
   - Tribe filtering (matching both `plan.tribes` and the commander's own creature subtype, case-insensitively).
   - All 4 sort modes (`coverage`, `popularity`, `power`, `combined`), verifying `edhrecRank` ordering (`null` last) and `isGameChanger` / `strength` boosting `powerScore`.
2. **Catalog Scryfall ACL test (`src/modules/catalog/infrastructure/scryfall.test.ts`):**
   - Maps `edhrec_rank` from Scryfall JSON to `edhrecRank` (and defaults missing/null to `null`).
3. **Integration test (`tests/integration/commanders.int.test.ts`):**
   - Verifies `commandersICanBuild` with `theme`, `tribe`, and `sort` options against the database.
