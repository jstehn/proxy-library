# Design: Pack engine

- **Phase:** 5
- **Status:** Approved (2026-09-27)
- **Related ADRs:** 0008 (server-side, seeded randomness), 0011 (printing × finish), 0003 (Result)

## 1. Purpose & scope

The `packs` module turns a **booster recipe** from the catalog into an actual **pack of cards**,
with the same odds as the real product, and decides the order the cards are revealed in. It's
the heart of the app's "opening packs" feel, and the most statistics-heavy module.

Decided with the user:

- **Reveal order builds suspense:** commons first, the rare/mythic last, and among equals the
  cheapest first, so the most valuable card is the final flip.
- **A pack simulator for admins only:** "open 1,000 packs" to check a set's odds. Nothing is
  kept and no money moves.
- **Color balance** is applied where MTGJSON marks a sheet (commons of every color).

**Out of scope:** buying and owning packs, and opening boxes or bundles into packs (Phase 6,
`inventory`). The opening animation is Phase 8. This phase is a pure engine plus the admin
simulator.

## 2. Vocabulary

| Term               | Meaning in this codebase                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Booster recipe** | MTGJSON's booster config for one pack type (e.g. BLB `play`): **variants** and **sheets**.                                                                               |
| **Variant**        | One possible pack layout, chosen by weight, e.g. "7 common, 3 uncommon, 1 wildcard, 1 rare/mythic, 1 foil, 1 land". Up to 51 per recipe in real data (Jumpstart themes). |
| **Slot**           | One line of a variant: "draw N cards from sheet S".                                                                                                                      |
| **Sheet**          | A weighted list of printings to draw from (like a real print sheet). Flags: foil, allow duplicates, balance colors, fixed.                                               |
| **Fixed sheet**    | A sheet whose cards are _all_ included, each as many times as its weight says (e.g. a Foundations beginner deck: 15 cards, 20 copies).                                   |
| **Seed**           | The input that makes the random generator repeatable. The same recipe and seed always give the same pack.                                                                |
| **Reveal order**   | The order cards are shown when a pack is opened.                                                                                                                         |
| **Pull**           | A card you got from a pack.                                                                                                                                              |

## 3. Domain model

```ts
// packs/domain/pack.ts
export type PackCard = Readonly<{
  printingId: PrintingId;
  finish: Finish;
  sheet: string; // which sheet it came from, e.g. "rareMythic", "foil"
}>;

export type Pack = Readonly<{
  setCode: SetCode;
  boosterType: string;
  seed: string; // store it, and the pack can be regenerated exactly (ADR 0008)
  variantIndex: number;
  cards: readonly PackCard[]; // in reveal order
}>;

/** What the engine needs to know about each printing a recipe can produce. */
export type PrintingFacts = Readonly<{
  finishes: readonly Finish[];
  colors: readonly Color[];
  rarity: Rarity;
  isBasicLand: boolean;
  marketPrice: Readonly<Partial<Record<Finish, Cents>>>; // for reveal order and pack value
}>;
export type FactsLookup = (id: PrintingId) => PrintingFacts; // throws for an unknown id (a bug)
```

### The algorithm: pure functions

```ts
/** Recipe + seeded Rng → the pack's cards (not yet in reveal order). */
export function generatePack(
  config: BoosterConfig,
  rng: Rng,
  facts: FactsLookup,
): { variantIndex: number; cards: PackCard[] };
```

1. **Choose a variant** with `weightedPick` (from the kernel, lesson 01) by variant weight.
2. **For each slot** `{ sheet: count }`:
   - **fixed sheet:** add every card, each `weight` times, in listed order;
   - **allows duplicates:** `count` independent `weightedPick`s;
   - **otherwise:** `weightedSample(rng, cards, count)`, which gives `count` _different_ cards;
   - **balance colors:** if the sheet is marked, redraw (up to 50 tries) until the mono-colored
     cards drawn include all five colors (W, U, B, R, G). Redrawing, rather than forcing picks,
     keeps every card's relative odds. If 50 tries fail (a sheet that can't manage it), the last
     draw is kept.
3. **Finish** per card: a foil sheet gives `foil` (or `etched` if that's the printing's only
   foil-like finish); a regular sheet gives `nonfoil` (or the printing's only finish, e.g. a
   foil-only promo).

```ts
/** Suspense order: see rule 8. Pure: sorts by tier, then market price. */
export function revealOrder(cards: readonly PackCard[], facts: FactsLookup): PackCard[];

/** What the recipe promises on average, per pack: expected cards of each rarity, and foils. */
export function expectedPerPack(
  config: BoosterConfig,
  facts: FactsLookup,
): Readonly<Record<Rarity | "foil", number>>;
```

`expectedPerPack` is calculated exactly from the weights (no simulation). For each variant,
weighted by its probability, each slot contributes `count × (sheet weight of that rarity ÷ total
sheet weight)`. It's exact for single-card slots and single-rarity sheets, which covers the rare,
mythic, wildcard and foil slots that matter. The simulator compares these with what it observes.

## 4. Rules (invariants)

1. **Repeatable:** the same recipe and seed always produce the same pack, card for card.
2. **Exact layout:** a pack has exactly the slot counts of the variant it rolled.
3. **No duplicates within a draw** unless the sheet allows them. A fixed sheet contributes
   exactly its listed cards and copies.

   **3b. No repeats between slots of one rarity** (added 2026-09-30). A slot whose sheet holds
   one rarity band (commons, uncommons, the rare slot, a common-or-uncommon slot, lands) never
   gives a card, in the same finish, that another such slot or a fixed list already gave. The
   **any-rarity** slots, whose sheets mix commons or uncommons with rares or mythics (the
   non-foil wildcard, the traditional foil), may repeat a card, as in real packs. Basic lands
   may always repeat. Fixed lists are drawn first, then the rest in name order, so every random
   slot can avoid them. Found in Reality Fracture Play Boosters, where the common-or-uncommon
   slot repeated one of the commons or the uncommon in about 4% of packs.

4. **Finishes:** foil sheets give foil (or etched) cards; other sheets give nonfoil, unless the
   printing only exists in one finish. Every card's finish is one the printing actually has.
5. **Color balance** on marked sheets: all five colors among the slot's mono-colored cards
   whenever the sheet can manage it within 50 tries.
6. **Every card is a real catalog printing** (guaranteed by catalog rule 5, and checked against
   every real recipe, see section 12).
7. **Randomness only through `Rng`** (ADR 0008). Production seeds come from the operating system
   (`randomSeed()`); the seed is part of the `Pack`, so any pack can be replayed.
8. **Reveal order** (decided in review, "build suspense"), in tiers:
   1. nonfoil commons (not basic lands)
   2. nonfoil uncommons
   3. basic lands
   4. foil commons and uncommons
   5. rares, mythics and specials (special guests, bonus sheets) in any finish

   Within a tier, the cheapest first by market price for that finish (unknown price counts as
   $0), then by collector number. So the most valuable card is always the last flip.

## 5. Use cases

| Use case           | Who    | Input                                 | Success            | Errors (`kind`)                                   |
| ------------------ | ------ | ------------------------------------- | ------------------ | ------------------------------------------------- |
| `openBooster`      | system | setCode, boosterType, seed            | `Pack`             | `BoosterUnavailable`                              |
| `simulateOpenings` | admin  | setCode, boosterType, count (1–1,000) | `SimulationReport` | `Forbidden`, `BoosterUnavailable`, `CountInvalid` |

`openBooster` is what Phase 6 calls when a player opens a pack inside the opening transaction. It
only reads. `simulateOpenings` draws a fresh OS seed, derives each pack's seed from it
(`<seed>-1`, `<seed>-2`, …), and returns:

```ts
type SimulationReport = {
  seed: string;
  packs: number;
  expected: Record<Rarity | "foil", number>; // per pack, from the recipe
  observed: Record<Rarity | "foil", number>; // per pack, averaged over the simulation
  averageValue: Cents; // market value of an average pack
  bestPulls: { printingId; finish; price }[]; // the 10 most valuable cards seen
  samplePacks: Pack[]; // the first 3 packs, to look at
};
```

## 6. Ports

```ts
/** Reads recipes and printing facts from the catalog (implemented over the catalog's tables). */
export interface BoosterSource {
  boosterConfig(setCode: SetCode, boosterType: string): Promise<BoosterConfig | null>;
  /** Facts for every printing a recipe can produce, in one query. */
  printingFacts(ids: readonly PrintingId[]): Promise<Map<PrintingId, PrintingFacts>>;
  /** Enabled sets and their booster types, for the simulator's pickers. */
  availableBoosters(): Promise<{ setCode: SetCode; setName: string; boosterTypes: string[] }[]>;
}
export interface SeedSource {
  newSeed(): string;
} // randomSeed() in production, fixed in tests
```

Adapter: `drizzleBoosterSource`. It reads `booster_configs` and **re-checks the stored JSON with
Zod** (it was written by our own import, but a database column is still an outside boundary),
plus `printings` and the latest `price_snapshots`. The fakes serve the recorded Bloomburrow
fixture.

## 7. State machines

None. A pack is a value, created and never changed.

## 8. Persistence

None new. This phase only **reads** the catalog. Packs are stored by Phase 6 (the seed is enough
to replay one; the generated cards are stored too, so a later catalog change can never alter a
pack a player already opened).

## 9. Read models

`availableBoosters` above, for the simulator page's dropdowns.

## 10. Screens

| Route          | Who    | Purpose                                                                                                                                                                                                                        |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/admin/packs` | admins | **Pack lab**: pick a set, booster type and count (1 / 10 / 100 / 1,000) → sample packs in reveal order (with hover-to-read cards), expected vs observed per rarity and foil, average pack value, best pulls, and the seed used |

## 11. Patterns applied

- **Functional core (1):** the whole engine (`generatePack`, `revealOrder`, `expectedPerPack`) is
  pure. The use cases just load the recipe and facts and call it.
- **Strategy (11):** sheets are drawn by one of three small functions (fixed, with duplicates,
  without duplicates), chosen by the sheet's flags from a lookup, not an if-chain.
- **Injected nondeterminism (17):** `Rng` in the engine and `SeedSource` in the simulator.
- **Ports & adapters (2):** the engine never touches the database. `BoosterSource` does.
- **Parse, don't validate (9):** stored booster JSON is re-parsed with Zod when read.

## 12. Test plan

- **Properties** (fast-check, on the real Bloomburrow fixture recipe with random seeds): the same
  seed gives the same pack; slot counts match the rolled variant; no duplicates within
  non-duplicate sheets; every finish is valid for its printing; every card exists.
- **Statistics** (seeded, so repeatable): over 20,000 packs, the variant frequencies and the
  rare-vs-mythic split in the rare slot match the recipe within about 4 standard errors (a
  standard error is how much a measured rate naturally wobbles for a given sample size).
  Observed averages match `expectedPerPack`.
- **Unit:** fixed sheets (exact copies, in order); color balance (a marked sheet always ends up
  with all five colors when possible; an impossible sheet gives up after 50 tries); `revealOrder`
  tiers and price ties; finishes for foil-only and etched-only printings.
- **Real-data check** (lesson 04: fixtures don't catch everything): a `pnpm worker check-packs`
  command opens 1,000 packs of **every real recipe** in the database (96 today) and reports
  anything wrong: a sheet too small, an unknown printing, an invalid finish, or a pack whose size
  differs from its variant. It's run once for real before the screens are built.
- **Integration:** `drizzleBoosterSource` reads the fixture recipe and facts back from Postgres,
  including the latest price per finish.
- **End-to-end:** an admin opens the Pack lab, simulates 10 BLB play boosters, and sees sample
  packs and the rarity table.

## 13. Lesson 05 outline

"Randomness you can trust": weighted sampling with and without replacement; seeds and
reproducibility; rejection sampling (the color balance); expected value from a recipe versus
Monte Carlo simulation; standard error and why "within 4 standard errors" makes statistical
tests reliable; property tests that generate seeds; and checking every real recipe. The lesson
compares these with NumPy/pandas equivalents throughout.

## 14. Decisions from review

1. Simulator size limit: **1,000 packs per run**.
2. "Special" and "bonus" rarities are revealed **with the rares/mythics** (last tier).
3. **A pack's price is its MSRP; its contents are valued at market** (ADR 0014). Buying a pack,
   including a single pack, costs MSRP. The cards inside are worth what they'd fetch as singles,
   which is market price. The Pack lab shows the market value of the average pack's contents in
   this phase. When Phase 6 adds the MSRP table, it also shows the pack's MSRP next to that value
   ("costs $5.49, contents average $3.80").

## 15. Implementation notes (what changed while building)

**Checked against real data first.** `pnpm worker check-packs` opened 1,000 packs of each of the
96 real recipes (96,000 packs, under 3 seconds) and found no problems. Simulated odds matched the
recipes, for example Bloomburrow play mythics at 0.194 expected and 0.197 observed, and Lost
Caverns collector foils at 11.33 expected and 11.31 observed.

- **Slots are drawn in name order**, not in the recipe's key order. Postgres reorders JSON keys,
  so without this, how a recipe happened to be stored could change which cards a seed produced.
- **Color balance gives up at once when it's impossible:** fewer than five cards in the slot, or a
  sheet without a mono-colored card of every color. It only redraws when success is possible.
- **Finishes:** a foil sheet whose name contains "etched" gives etched cards. Otherwise the
  preference order is foil, etched, nonfoil on foil sheets, and nonfoil, foil, etched on regular
  ones, picking the first finish the printing has.
- **A fixed sheet whose slot count differs from its total weight** repeats (or cuts) its list.
  The real data never does this, but it keeps rule 2 exact.
- **`availableBoosters` is a query**, not part of the `BoosterSource` port: only the Pack lab's
  picker uses it. The port gained `boosterKeys()` for `check-packs` instead.
- **`openBooster` runs inside the caller's transaction** (it takes `PacksServices`, like
  `bringUpToDate` in the wallet), ready for Phase 6's "open a pack". `makePacks` builds only the
  admin use cases.
- **Lint:** a domain may now import another module's public API **with `import type` only**. The
  pack engine uses the catalog's `BoosterConfig` this way. A module's `testing/` folder may import
  other modules' public APIs (to build sample data), which is how domain tests get a `PrintingId`.
- **`CardTile` moved to `src/app/_components/`**, shared by the set page and the Pack lab, and
  gained a still foil sheen. The animated one is Phase 8.
- **`printingCards(db, ids)`** was added to the catalog's queries. It shares its SQL with
  `setPrintings`.
