import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

// Architecture rules. Each block maps to a decision in docs/adr/0009-lint-enforced-boundaries.md.

const SOURCE = ["src/**/*.{ts,tsx}", "worker/**/*.ts"];
const TESTS = ["**/*.test.ts", "**/*.int.test.ts", "**/*.contract.ts"];

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
  // src/modules/<module>/<layer>: domain | application | infrastructure | queries | testing
  { type: "module-layer", pattern: "src/modules/*/*", capture: ["module", "layer"] },
  // src/modules/<module> itself, which holds only index.ts: the module's public API
  { type: "module", pattern: "src/modules/*", capture: ["module"] },
  { type: "worker", pattern: "worker" },
  { type: "test-setup", pattern: "tests" },
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
const publicApi = { element: { type: "module", fileInternalPath: "index.ts" } };

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

  // module layers: the dependency rule points inward (overview.md)
  from(layer("domain"), el("kernel"), layer("domain", { sameModule: true })),
  // A domain may use another module's vocabulary (its types), never its code: `import type`
  // only. The pack engine works on the catalog's BoosterConfig this way (overview.md).
  { from: layer("domain"), allow: { to: publicApi, dependency: { kind: "type" } } },
  from(
    layer("application"),
    el("kernel"),
    layer("domain", { sameModule: true }),
    layer("application", { sameModule: true }),
    publicApi, // other modules, only through their public API
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
  ),
  from(
    layer("queries"),
    el("kernel"),
    el("db"),
    layer("domain", { sameModule: true }),
    layer("queries", { sameModule: true }),
    layer("infrastructure", { file: "schema.ts" }), // reads may join across modules (ADR 0006)
  ),
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
    layer("domain", { sameModule: true }),
    layer("application", { sameModule: true }),
    layer("queries", { sameModule: true }),
  ),

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
    layer("infrastructure", { file: "index.ts" }),
  ),

  // delivery (Next.js): controllers and views
  from(el("app"), el("app"), el("ui"), el("server"), el("kernel"), publicApi),
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
    layer("infrastructure", { file: "index.ts" }),
  ),
  {
    from: { file: { categories: "test" } },
    allow: {
      to: [el("kernel-testing"), el("config"), el("db"), el("runtime"), layer("testing")],
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
            "Architecture: {{ from.element.types.[0] }}{{#if from.element.captured.module}} ({{ from.element.captured.module }}{{#if from.element.captured.layer}}/{{ from.element.captured.layer }}{{/if}}){{/if}} may not import {{ to.element.types.[0] }}{{#if to.element.captured.module}} ({{ to.element.captured.module }}{{#if to.element.captured.layer}}/{{ to.element.captured.layer }}{{/if}}){{/if}}. See docs/architecture/overview.md.",
          policies,
        },
      ],
      "import/no-cycle": "error",
    },
  },

  // Pure code: the kernel and every module's domain import no frameworks, DB, or Node APIs.
  {
    files: ["src/shared/kernel/**/*.ts", "src/modules/*/domain/**/*.ts"],
    ignores: TESTS,
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
    ignores: [...TESTS, "src/shared/runtime/**", "src/shared/kernel/testing/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
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
    ignores: ["src/shared/http/**", "src/modules/*/infrastructure/**"],
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

  globalIgnores([".next/**", ".next-e2e/**", "out/**", "build/**", "next-env.d.ts", "drizzle/**"]),
]);
