// The "one regex, one place" rule (design doc 66, section 10; ADR 0027): a regex literal that tests
// a card's rules text belongs in a recognizer (`src/modules/catalog/domain/features/recognizers/`),
// never in a consumer. Consumers ask `catalog.cardFeatures` instead.
//
// It looks for the shapes `/…/.test(text)`, `/…/.exec(text)` and `text.match(/…/)` (also
// `matchAll`, `replace`, `replaceAll`, `search`), where the text side is named like a card's text:
// it contains "text", "oracle", "lower" or "typeline" (so `faceText`, `plainText`, `oracleText`).

const TEXT_NAME = /text|oracle|lower|typeline/i;
const TEST_METHODS = new Set(["test", "exec"]);
const TEXT_METHODS = new Set(["match", "matchAll", "replace", "replaceAll", "search"]);

/** The name at the heart of an expression: `card.text.toLowerCase()` is "text". */
function nameOf(node) {
  if (node === undefined) return "";
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed) {
    return TEXT_NAME.test(node.property.name) ? node.property.name : nameOf(node.object);
  }
  if (node.type === "CallExpression") return nameOf(node.callee);
  if (node.type === "TemplateLiteral" || node.type === "BinaryExpression") return "text";
  return "";
}

const isRegex = (node) => node?.type === "Literal" && node.regex !== undefined;

export const oracleTextRegex = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      moved:
        "A regex over card text belongs in a recognizer (catalog/domain/features/recognizers/). Read what a card does from `catalog.cardFeatures` (design doc 66).",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        const method = callee.property.name;
        const reads =
          (TEST_METHODS.has(method) &&
            isRegex(callee.object) &&
            TEXT_NAME.test(nameOf(node.arguments[0]))) ||
          (TEXT_METHODS.has(method) &&
            isRegex(node.arguments[0]) &&
            TEXT_NAME.test(nameOf(callee.object)));
        if (reads) context.report({ node, messageId: "moved" });
      },
    };
  },
};

/**
 * Files allowed to keep a regex the rule would flag, each with its reason (sorted). The rule matches
 * by variable name, so these are not (or not yet) card-feature recognizers.
 */
export const REGEX_ALLOWED = [
  // The deck's origin is stored as "draft:12": a code of ours, not rules text. `text` is only the name.
  "src/modules/decks/core/domain/deck.ts",
  // Deck legality reads commander and copy-limit rules from `CardRules.text` ("can be your
  // commander", "Partner", "any number of cards named"). The same check runs in the browser
  // builder on a deck view that carries no `CardFeatures`, so moving these into recognizers means
  // adding a commander-rules feature to every `CardRules` loader (a feature of its own, with a
  // FEATURES_VERSION bump).
  "src/modules/decks/core/domain/rules.ts",
  // The search language parser reads the player's query ("rw", "esper", "simic"), not a card's
  // text; `text` is the name of the query word being parsed.
  "src/shared/card-search/parse.ts",
];
