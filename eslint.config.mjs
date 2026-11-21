import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";
import { cardNameLiteral } from "./eslint-rules/card-name-literal.mjs";
import { NOT_YET_RECOGNIZED, oracleTextRegex } from "./eslint-rules/oracle-text-regex.mjs";

// Architecture rules. Each block maps to a decision in docs/adr/0009-lint-enforced-boundaries.md.

// The modules that are split into areas (ADR 0029 for decks, ADR 0030 for the others), each area
// with the areas it may import (always through that area's index.ts or client.ts). Only these
// names and the cycle check's table (scripts/dev/check-cycles.ts) spell the areas out.
const AREA_ARROWS = {
  decks: {
    core: [],
    scoring: ["core"],
    play: ["core"],
    proxies: ["core"],
    building: ["core", "scoring", "play"],
    overview: ["core", "scoring", "play", "proxies", "building"],
  },
  catalog: { outside: [], rules: ["outside"], cards: ["outside"] },
  collection: { copies: [], game: ["copies"], real: ["copies"] },
  research: { reddit: [], youtube: [] },
};
const AREA_MODULES = Object.keys(AREA_ARROWS);
const AREA_NAMES = [...new Set(Object.values(AREA_ARROWS).flatMap((areas) => Object.keys(areas)))];
// Every (module, area) pair, with the areas it may import.
const AREAS = Object.entries(AREA_ARROWS).flatMap(([module, areas]) =>
  Object.entries(areas).map(([area, mayImport]) => ({ module, area, mayImport })),
);

const SOURCE = ["src/**/*.{ts,tsx}", "worker/**/*.ts"];
// The two card rules (eslint-rules/), one plugin so blocks that overlap agree on it.
const CARDS_PLUGIN = {
  rules: { "oracle-text-regex": oracleTextRegex, "card-name-literal": cardNameLiteral },
};
// The folders that hold card rules (design doc 66): the regex-count ratchet watches the same ones.
const CARD_RULE_FOLDERS = [
  "src/modules/decks/!(overview)/domain",
  "src/shared/card-search",
  "src/modules/drafts/domain",
  "src/modules/catalog/*/domain",
];
const TESTS = ["**/*.test.ts", "**/*.int.test.ts", "**/*.remote.test.ts", "**/*.contract.ts"];

// --- Elements: what kind of architectural unit each file belongs to --------------------
const elements = [
  { type: "app", pattern: "src/app" },
  { type: "ui", pattern: "src/ui" },
  { type: "server", pattern: "src/server" },
  { type: "kernel-testing", pattern: "src/shared/kernel/testing" },
  { type: "kernel", pattern: "src/shared/kernel" },
  { type: "runtime", pattern: "src/shared/runtime" },
  { type: "db", pattern: "src/shared/db" },
  { type: "http", pattern: "src/shared/http" },
  { type: "config", pattern: "src/shared/config" },
  // The card search language and card lists (ADR 0017): pure code, safe for the browser.
  { type: "card-search", pattern: "src/shared/card-search" },
  // The areas of the split modules (ADR 0029, 0030): src/modules/<module>/<area>/<layer>, and the
  // area's own index.ts and client.ts. A file there is a module-layer like any other, plus its area.
  {
    type: "module-layer",
    pattern: `src/modules/@(${AREA_MODULES.join("|")})/*/@(domain|application|infrastructure|queries|testing)`,
    capture: ["module", "area", "layer"],
  },
  {
    type: "module-area",
    pattern: `src/modules/@(${AREA_MODULES.join("|")})/@(${AREA_NAMES.join("|")})`,
    capture: ["module", "area"],
  },
  // src/modules/<module>/<layer>: domain | application | infrastructure | queries | testing
  { type: "module-layer", pattern: "src/modules/*/*", capture: ["module", "layer"] },
  // src/modules/<module> itself, which holds only index.ts: the module's public API
  { type: "module", pattern: "src/modules/*", capture: ["module"] },
  { type: "worker", pattern: "worker" },
  { type: "test-setup", pattern: "tests" },
];

// Paths like `[id]` and `(auth)` are glob syntax, so they are escaped to match literally.
const escapeGlob = (path) => path.replace(/[[\]()]/g, "\\$&");

// The rule on `getContainer` in src/app (ADR 0026): adapters get what they need from `action()` or
// `readPage()`.
// These keep `getContainer`, each for a reason.
const CONTAINER_ALLOWED = [
  // the OAuth endpoints read the app's origin synchronously (resourceMetadataUrl is called from plain functions), so they can't await readPage()
  "src/app/_oauth/http.ts",
  // the health check has no player and reads no capability: it asks the container whether it is up
  "src/app/api/health/route.ts",
];

// --- Selector helpers ------------------------------------------------------------------
const el = (type) => ({ element: { type } });
const layer = (name, { sameModule = false, file } = {}) => ({
  element: {
    type: "module-layer",
    captured: sameModule
      ? { module: "{{ from.element.captured.module }}", layer: name }
      : { layer: name },
    ...(file ? { fileInternalPath: file } : {}),
  },
});
const from = (selector, ...to) => ({ from: selector, allow: { to } });
// A file of one area of a split module, and an area's public API (its index.ts and client.ts).
const areaFile = (module, area) => ({
  element: { type: "module-layer", captured: { module, area } },
});
const areaApi = (module, area, file) => ({
  element: {
    type: "module-area",
    captured: { module, ...(area ? { area } : {}) },
    ...(file ? { fileInternalPath: file } : {}),
  },
});
// The areas of the module a file is in (a module's own root files, index.ts and wiring.ts).
const ownAreaApi = {
  element: { type: "module-area", captured: { module: "{{ from.element.captured.module }}" } },
};
// The real collection's door (design doc 16, rule 1): not the module's index.ts, so lint can see
// who asks. Only the app, the composition roots and the tests may use it.
const realCollectionApi = areaApi("collection", "real", "index.ts");
const publicApi = { element: { type: "module", fileInternalPath: "index.ts" } };
// A module's browser-safe public API (ADR 0016): pure domain code only, for client components.
// A module's wiring.ts builds its capabilities (ADR 0026); only the composition roots import it.
const wiringFile = { element: { type: "module", fileInternalPath: "wiring.ts" } };
const clientApi = { element: { type: "module", fileInternalPath: "client.ts" } };
// The card search language (pure), and the SQL that runs it: it lives in catalog/cards/queries
// (ADR 0017, 0030), and every module's queries may import that one file.
const cardSearch = { element: { type: "card-search", fileInternalPath: "index.ts" } };
const cardSearchSql = {
  element: {
    type: "module-layer",
    captured: { module: "catalog", area: "cards", layer: "queries" },
    fileInternalPath: "search-sql.ts",
  },
};

// --- no-restricted-syntax selectors ----------------------------------------------------
// Class names in pages and components (refactor P31): colours come from the tokens in
// globals.css and a long class string is a block in src/ui, not a copy.
const CLASS_NAMES = [
  {
    selector: "JSXAttribute[name.name='className'] Literal[value=/zinc-/]",
    message:
      "Use a colour token (text-muted, border-line, bg-surface, ...) or a block from src/ui.",
  },
  {
    selector: "JSXAttribute[name.name='className'] TemplateElement[value.raw=/zinc-/]",
    message:
      "Use a colour token (text-muted, border-line, bg-surface, ...) or a block from src/ui.",
  },
  {
    selector: "JSXAttribute[name.name='className'] > Literal[value=/^.{101,}$/]",
    message: "A class string over 100 characters: use a block from src/ui (Button, Card, ...).",
  },
];

const NONDETERMINISM = [
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message: "Inject an Rng instead of Math.random (ADR 0008).",
  },
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message: "Inject a Clock instead of Date.now (ADR 0008).",
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: "Inject a Clock instead of new Date() (ADR 0008).",
  },
];
const BASIC_WORDS = [
  {
    selector:
      "CallExpression[callee.object.name='z'][callee.property.name='enum'] ArrayExpression > Literal[value=/^(nonfoil|foil|etched|W|common|mythic)$/]",
    message:
      "Don't spell out finishes, colors or rarities: import FinishSchema, ColorSchema or RaritySchema from @/shared/kernel.",
  },
  {
    // The dots stand for the backslashes of /\bLand\b/.
    selector: "Literal[regex.pattern=/^.b(Land|Creature|Basic).b$/]",
    message:
      "Ask the type line with cardTypes, isLand, isCreature or isBasicLand from @/shared/kernel, not a regex.",
  },
];
const MONEY_TEXT = [
  {
    selector:
      "CallExpression[callee.property.name='toFixed'][callee.object.type='BinaryExpression'][callee.object.operator='/'][callee.object.right.value=100]",
    message: "Format money with Cents.format (or Cents.toPlainDollars) from @/shared/kernel.",
  },
];
const PRICE_TABLE = [
  {
    selector: "TemplateElement[value.raw=/price_snapshots/]",
    message:
      "Read prices through the fragments in @/shared/db (latestPrice, cheapestPrice, ...): only the catalog module and shared/db/prices.ts name the price_snapshots table.",
  },
];
const CANDIDATE_SQL = [
  {
    selector:
      "TemplateElement[value.raw=/order by latest\\.usd_cents|array_agg\\(c\\.printing_id/]",
    message:
      "Cards you own (one per card) and the cheapest printing for sale are written once, in decks/building/queries/candidate-pool.ts: use ownedPerCard, notOwned, cheapestForSale or cheapestOfCards.",
  },
];

// A deck's format is compared nowhere but in format-rules.ts (refactor P10): ask a question of
// formatRules(format) instead, so a new format is a compile error until its rules are filled in.
const FORMAT_NAMES = [
  {
    selector:
      "BinaryExpression[operator=/^[!=]==?$/][right.type='Literal']:matches([left.name='format'], [left.property.name='format'][left.computed=false])",
    message:
      "Don't compare a format's name. Ask a question of formatRules(format) from decks/core/domain/format-rules.ts (client code: @/modules/decks/client), and add the question there if it's missing (refactor P10).",
  },
];

// A type line is read in one place (refactor P26): kernel/card-types.ts. Tests may spell it out.
const TYPE_LINE_WORDS = [
  {
    selector: "Literal[regex.pattern=/\\\\b(Legendary|Creature|Land|Planeswalker)\\\\b/]",
    message:
      "Read a type line with cardTypes(), isLand(), isCreature() or hasTypeWord() from @/shared/kernel (refactor P26).",
  },
];

// An `Actor` is made in one place (design doc 67, section 6): `toActor` in accounts/domain/player.ts.
// Tests and `testing/` folders may cast one (they use `testActor`).
const FORGED_ACTOR = [
  {
    selector: "TSAsExpression[typeAnnotation.typeName.name=/^(Actor|AdminActor)$/]",
    message:
      "Don't cast to Actor or AdminActor: only accounts' toActor and asAdmin make one. Tests use testActor() from @/modules/accounts/testing/actors (design doc 67).",
  },
];

// What every page and component file is held to (ADR 0026 and the card-rule selectors).
const APP_SYNTAX = [
  {
    selector: "CallExpression[callee.name='getContainer']",
    message: "Call capabilities through action() or readPage() (ADR 0026).",
  },
  ...FORMAT_NAMES,
  ...TYPE_LINE_WORDS,
  ...FORGED_ACTOR,
];

// --- Policies: who may import whom (everything else is disallowed) -----------------------
const policies = [
  // npm packages and Node built-ins: allowed here, restricted per layer by no-restricted-imports.
  { allow: { to: { module: { origin: ["external", "core"] } } } },

  // shared/
  from(el("kernel"), el("kernel")),
  from(el("kernel-testing"), el("kernel"), el("kernel-testing")),
  from(el("runtime"), el("kernel")),
  from(el("db"), el("kernel"), el("db")),
  from(el("http"), el("kernel"), el("http")),
  from(el("card-search"), el("kernel"), el("card-search")),

  // module layers: the dependency rule points inward (overview.md)
  from(layer("domain"), el("kernel"), layer("domain", { sameModule: true }), cardSearch),
  // A domain may use another module's vocabulary (its types), never its code: `import type`
  // only. The pack engine works on the catalog's BoosterConfig this way (overview.md).
  { from: layer("domain"), allow: { to: publicApi, dependency: { kind: "type" } } },
  from(
    layer("application"),
    el("kernel"),
    layer("domain", { sameModule: true }),
    layer("application", { sameModule: true }),
    publicApi, // other modules, only through their public API
    cardSearch,
  ),
  from(
    layer("infrastructure"),
    el("kernel"),
    el("db"),
    el("http"),
    layer("domain", { sameModule: true }),
    layer("application", { sameModule: true }),
    layer("infrastructure", { sameModule: true }),
    layer("infrastructure", { file: "schema.ts" }), // foreign keys to other modules' tables
    publicApi, // other modules' public types (e.g. Actor), never their internals
    // Design doc 23: which copies are yours, and which is most special, are one SQL definition
    // shared by the read side and the decks' card lookup, so a pasted list and the builder agree.
    layer("queries", { sameModule: true, file: "owned.ts" }),
    // Design doc 26: what's for sale and what you own of a wished card are one SQL definition,
    // shared by the Wishlist page and the wishlist's use cases, so "cheapest" means the same.
    layer("queries", { sameModule: true, file: "for-sale.ts" }),
    // Design doc 66: which printing's text the recognizers read is one SQL definition, shared by
    // the `cardFeatures` read and the features pass, so a stored row equals a computed one.
    layer("queries", { sameModule: true, file: "card-texts.ts" }),
  ),
  from(
    layer("queries"),
    el("kernel"),
    el("db"),
    layer("domain", { sameModule: true }),
    layer("queries", { sameModule: true }),
    layer("infrastructure", { file: "schema.ts" }), // reads may join across modules (ADR 0006)
    cardSearch,
    cardSearchSql, // searches run as SQL in queries (ADR 0017)
  ),
  // A query takes the `Actor` (design doc 67): another module's public API, for its types only.
  { from: layer("queries"), allow: { to: publicApi, dependency: { kind: "type" } } },
  // Design doc 66: the one decks read that calls the catalog for card features (a value, so the
  // lazy repair of a missing row stays in the catalog).
  { from: layer("queries", { file: "card-features.ts" }), allow: { to: publicApi } },
  { from: layer("queries", { file: "tap-mana.ts" }), allow: { to: publicApi } },
  // The signals read (deck_signals) reads the stored features the same way.
  { from: layer("queries", { file: "card-facts.ts" }), allow: { to: publicApi } },
  from(
    layer("testing"),
    el("kernel"),
    el("kernel-testing"),
    layer("domain", { sameModule: true }),
    layer("application", { sameModule: true }),
    layer("testing", { sameModule: true }),
    publicApi, // fakes and sample data built from other modules' types and constructors
  ),
  from(
    el("module"),
    el("kernel"),
    layer("domain", { sameModule: true }),
    layer("application", { sameModule: true }),
    layer("queries", { sameModule: true }),
    ownAreaApi,
  ),

  // wiring.ts (ADR 0026): builds the module's capabilities from its own layers and the readers it
  // takes from other modules' public APIs. It is the one place a module's queries meet its use cases.
  {
    from: wiringFile,
    allow: { to: [el("kernel"), el("db"), publicApi, ownAreaApi] },
  },

  // The areas of the split modules (ADR 0029, 0030): a file imports another area only through its
  // index.ts or client.ts (fakes in testing/ too), and only along the arrows of AREA_ARROWS. The
  // layer rules above allow any layer of the same module, so these come after them and take it back.
  ...AREAS.flatMap(({ module, area, mayImport }) => [
    ...(mayImport.length === 0
      ? []
      : [
          {
            from: areaFile(module, area),
            allow: { to: mayImport.map((other) => areaApi(module, other)) },
          },
        ]),
    {
      from: areaFile(module, area),
      disallow: {
        to: {
          element: {
            type: "module-layer",
            captured: { module, area: `!(${area})`, layer: "!(testing)" },
            // table definitions are shared on purpose, as with other modules (ADR 0006)
            fileInternalPath: "!(schema.ts)",
          },
        },
      },
    },
    // An area's own index.ts and client.ts re-export only its own layers.
    {
      from: areaApi(module, area),
      allow: { to: { element: { type: "module-layer", captured: { module, area } } } },
    },
  ]),
  // client.ts is pure (ADR 0016): domain code only. A domain file never imports an index.ts.
  {
    from: areaApi(undefined, undefined, "client.ts"),
    disallow: {
      to: [layer("application"), layer("queries"), layer("infrastructure"), layer("testing")],
    },
  },
  { from: layer("domain"), disallow: { to: areaApi(undefined, undefined, "index.ts") } },
  { from: clientApi, disallow: { to: areaApi(undefined, undefined, "index.ts") } },

  // Design doc 16, rule 1: real cards never touch the game or its money. The real collection
  // (collection/real) is its own area with its own door, not part of the module's index.ts, so no
  // module may import it; only the app, the composition roots and the tests do (below). The area
  // imports `copies` and nothing else of its module (the arrows above), and never the wallet or
  // the store, where the game's money moves.
  {
    from: areaFile("collection", "real"),
    disallow: {
      to: [
        { element: { type: "module", captured: { module: "!(accounts|catalog|collection)" } } },
        {
          element: {
            type: "module-layer",
            captured: { module: "!(accounts|catalog|collection)" },
          },
        },
      ],
    },
  },

  // composition roots: the only places that see infrastructure (via its index.ts)
  from(
    el("server"),
    el("server"),
    el("kernel"),
    el("runtime"),
    el("db"),
    el("http"),
    el("config"),
    publicApi,
    realCollectionApi,
    wiringFile,
    layer("infrastructure", { file: "index.ts" }),
  ),
  from(
    el("worker"),
    el("worker"),
    el("server"),
    el("kernel"),
    el("runtime"),
    el("db"),
    el("config"),
    publicApi,
    wiringFile,
    layer("infrastructure", { file: "index.ts" }),
  ),

  // delivery (Next.js): controllers and views
  from(
    el("app"),
    el("app"),
    el("ui"),
    el("server"),
    el("kernel"),
    publicApi,
    clientApi,
    realCollectionApi,
    cardSearch, // client components may use it (ADR 0017)
  ),
  // client.ts re-exports only its own module's domain (no database code reaches the browser).
  {
    from: clientApi,
    disallow: {
      to: [layer("application"), layer("queries"), layer("infrastructure"), layer("testing")],
    },
  },
  from(el("ui"), el("ui"), el("kernel")),

  // tests may additionally use fakes, config and the database
  // Test setup acts like a small composition root: it may wire real modules together.
  from(
    el("test-setup"),
    el("kernel"),
    el("db"),
    el("config"),
    el("runtime"),
    publicApi,
    realCollectionApi,
    layer("infrastructure", { file: "index.ts" }),
    // The harness builds its players with testActor (design doc 67, section 6).
    layer("testing", { file: "actors.ts" }),
  ),
  {
    from: { file: { categories: "test" } },
    allow: {
      to: [
        el("kernel-testing"),
        el("config"),
        el("db"),
        el("runtime"),
        layer("testing"),
        // The integration harness (catalog fixtures, players), for the LLM tools' end-to-end test
        // in src/app (design doc 28): it drives app code no tests/ file may import.
        el("test-setup"),
      ],
    },
  },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    files: [...SOURCE, "tests/**/*.ts"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": elements.map((element) => ({ ...element, partialMatch: false })),
      "boundaries/files": [{ category: "test", pattern: TESTS }],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          message:
            "Architecture: {{ from.element.types.[0] }}{{#if from.element.captured.module}} ({{ from.element.captured.module }}{{#if from.element.captured.area}}/{{ from.element.captured.area }}{{/if}}{{#if from.element.captured.layer}}/{{ from.element.captured.layer }}{{/if}}){{/if}} may not import {{ to.element.types.[0] }}{{#if to.element.captured.module}} ({{ to.element.captured.module }}{{#if to.element.captured.area}}/{{ to.element.captured.area }}{{/if}}{{#if to.element.captured.layer}}/{{ to.element.captured.layer }}{{/if}}){{/if}}. See docs/architecture/overview.md.",
          policies,
        },
      ],
      // Import cycles are checked by `pnpm lint:cycles` (scripts/dev/check-cycles.ts), not by
      // import/no-cycle: that rule took over three minutes of every lint (ADR 0009, 2026-11-10).
    },
  },

  // Pure code: the kernel and every module's domain import no frameworks, DB, or Node APIs.
  {
    files: [
      "src/shared/kernel/**/*.ts",
      "src/modules/*/domain/**/*.ts",
      "src/modules/*/*/domain/**/*.ts",
      // the card search language
      "src/shared/card-search/**/*.ts",
    ],
    // kernel/schemas.ts is the one kernel file that may use zod: the Zod schemas of the basic
    // words (finish, color, rarity), shared by every module's parsing code (refactor P02).
    ignores: [...TESTS, "src/shared/kernel/schemas.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "next",
                "next/*",
                "react",
                "react/*",
                "drizzle-orm",
                "drizzle-orm/*",
                "pg",
                "zod",
                "node:*",
              ],
              message: "Domain and kernel code must stay pure (overview.md: dependency rule).",
            },
          ],
        },
      ],
    },
  },

  // Nondeterminism goes through injected ports (ADR 0008).
  {
    files: SOURCE,
    ignores: [
      ...TESTS,
      "src/shared/runtime/**",
      "src/shared/kernel/testing/**",
      "src/modules/decks/core/domain/format-rules.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...NONDETERMINISM,
        ...BASIC_WORDS,
        ...MONEY_TEXT,
        ...PRICE_TABLE,
        ...CANDIDATE_SQL,
        ...FORMAT_NAMES,
        ...TYPE_LINE_WORDS,
        ...FORGED_ACTOR,
      ],
    },
  },
  // A component file in src/app that passes 300 lines is a hint to split it (refactor P32); the
  // 500-line benchmark stays the gate.
  {
    files: ["src/app/**/*.tsx"],
    ignores: TESTS,
    rules: { "max-lines": ["warn", { max: 300, skipBlankLines: true, skipComments: true }] },
  },
  // Pages and components: the same rules plus the class-name rules above (refactor P31).
  {
    files: ["src/app/**/*.tsx", "src/ui/**/*.tsx"],
    ignores: TESTS,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...NONDETERMINISM,
        ...BASIC_WORDS,
        ...MONEY_TEXT,
        ...PRICE_TABLE,
        ...CANDIDATE_SQL,
        ...FORMAT_NAMES,
        ...TYPE_LINE_WORDS,
        ...FORGED_ACTOR,
        ...CLASS_NAMES,
      ],
    },
  },

  // The one place that makes an Actor (design doc 67): accounts' domain and its test helpers.
  {
    files: ["src/modules/accounts/domain/player.ts", "src/modules/accounts/testing/**/*.ts"],
    ignores: TESTS,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...NONDETERMINISM,
        ...BASIC_WORDS,
        ...MONEY_TEXT,
        ...PRICE_TABLE,
        ...CANDIDATE_SQL,
        ...FORMAT_NAMES,
        ...TYPE_LINE_WORDS,
      ],
    },
  },
  // The candidate pool's own SQL (refactor P07b) is the one place that may spell it out.
  {
    files: ["src/modules/decks/building/queries/candidate-pool.ts"],
    ignores: TESTS,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...NONDETERMINISM,
        ...BASIC_WORDS,
        ...MONEY_TEXT,
        ...PRICE_TABLE,
        ...FORMAT_NAMES,
        ...TYPE_LINE_WORDS,
        ...FORGED_ACTOR,
      ],
    },
  },
  // The basic words and money text are defined in exactly one place each (refactor P02): the
  // catalog and the kernel's schemas.ts / money.ts may spell them out (and shared/db/prices.ts the price table). They still follow ADR 0008.
  {
    files: [
      "src/modules/catalog/**/*.ts",
      "src/shared/kernel/schemas.ts",
      "src/shared/db/prices.ts",
    ],
    ignores: TESTS,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...NONDETERMINISM,
        ...MONEY_TEXT,
        ...FORMAT_NAMES,
        ...TYPE_LINE_WORDS,
        ...FORGED_ACTOR,
      ],
    },
  },
  {
    files: ["src/shared/kernel/money.ts"],
    ignores: TESTS,
    rules: { "no-restricted-syntax": ["error", ...NONDETERMINISM, ...BASIC_WORDS, ...PRICE_TABLE] },
  },
  {
    files: ["src/shared/runtime/**", "src/shared/kernel/testing/**"],
    ignores: TESTS,
    rules: { "no-restricted-syntax": ["error", ...BASIC_WORDS, ...MONEY_TEXT, ...PRICE_TABLE] },
  },

  // The ratchet (ADR 0026): no `getContainer` in src/app, except the files listed above.
  {
    files: ["src/app/**/*.{ts,tsx}"],
    ignores: [...TESTS, ...CONTAINER_ALLOWED.map(escapeGlob)],
    rules: { "no-restricted-syntax": ["error", ...APP_SYNTAX, ...CLASS_NAMES] },
  },
  // Everything in src/app reads through `reads` and capabilities (design doc 67): no file there, a
  // component included, imports the database or a module's `queries/` folder.
  {
    files: ["src/app/**/*.{ts,tsx}"],
    ignores: TESTS,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@/shared/db",
              message:
                "src/app never reads the database. Read through `reads` or call a capability (design doc 67).",
            },
            {
              regex: "^@/modules/.+/queries",
              message:
                "src/app never imports a module's queries/ folder. Read through `reads.<module>.<query>` (design doc 67).",
            },
          ],
        },
      ],
    },
  },

  // Adapters stay thin (ADR 0026): tool bindings and server actions parse input, call capabilities
  // and present the answer. Logic and data access live in the modules.
  {
    files: [
      "src/app/_llm-tools/bindings/**/*.ts",
      "src/app/**/actions.ts",
      "src/app/**/{page.tsx,route.ts,layout.tsx}",
    ],
    ignores: TESTS,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@/modules/.+/(domain|queries|application|infrastructure)",
              message:
                "An adapter imports a module only through its index.ts or client.ts (ADR 0026).",
            },
            {
              regex: "^@/shared/db",
              message: "An adapter never reads the database. Call a capability (ADR 0026).",
            },
            {
              regex: "(^|/)_llm-tools/tools/",
              message: "An adapter never calls another adapter (ADR 0026).",
            },
          ],
        },
      ],
    },
  },

  // Configuration is read in exactly one place.
  {
    files: SOURCE,
    ignores: ["src/shared/config/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Read config via shared/config.ts." },
      ],
    },
  },

  // Network access only through shared/http and module adapters.
  {
    files: SOURCE,
    ignores: [
      "src/shared/http/**",
      "src/modules/*/infrastructure/**",
      "src/modules/*/*/infrastructure/**",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Call external services through a gateway (ADR 0007)." },
      ],
    },
  },

  // Type-safety escapes.
  {
    files: SOURCE,
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },

  // One regex, one place (design doc 66): card text is read by recognizers only. The files in
  // NOT_YET_RECOGNIZED are the ones P12 to P14 still have to move; the list only shrinks.
  {
    files: CARD_RULE_FOLDERS.map((folder) => `${folder}/**/*.ts`),
    ignores: [
      ...TESTS,
      "src/modules/catalog/cards/domain/features/recognizers/**",
      // Parse the sets list, EDHREC pages and the rules book: not card text.
      "src/modules/catalog/rules/domain/comprehensive-rules.ts",
      "src/modules/catalog/outside/domain/edhrec.ts",
      "src/modules/catalog/cards/domain/wpn.ts",
      ...NOT_YET_RECOGNIZED,
    ],
    plugins: { cards: CARDS_PLUGIN },
    rules: { "cards/oracle-text-regex": "error" },
  },

  // No card is named in domain code (P14): a rule about one card is a feature or a data table.
  {
    files: ["src/modules/drafts/domain/**/*.ts", "src/modules/{catalog,decks}/*/domain/**/*.ts"],
    ignores: TESTS,
    plugins: { cards: CARDS_PLUGIN },
    rules: { "cards/card-name-literal": "error" },
  },

  globalIgnores([
    ".next/**",
    ".next-e2e/**",
    ".claude/worktrees/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "drizzle/**",
  ]),
]);
