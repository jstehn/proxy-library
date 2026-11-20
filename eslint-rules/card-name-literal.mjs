// No card is named in domain code (design doc 66, P14): `card.name === "Cogwork Librarian"` hides a
// rule in a string. A card's behaviour comes from its features, or from a data table keyed by name
// (DRAFT_ABILITIES in drafts/domain/abilities.ts: keys are fine, comparisons are not).

const COMPARISONS = new Set(["===", "!==", "==", "!="]);

/** `name` or `something.name`. */
const isName = (node) =>
  (node.type === "Identifier" && node.name === "name") ||
  (node.type === "MemberExpression" && !node.computed && node.property.name === "name");

const isString = (node) => node.type === "Literal" && typeof node.value === "string";

export const cardNameLiteral = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      named:
        "Don't compare a card's name with a string in domain code. Read what the card does from its features, or add it to a data table keyed by name (DRAFT_ABILITIES).",
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (!COMPARISONS.has(node.operator)) return;
        const { left, right } = node;
        if ((isName(left) && isString(right)) || (isName(right) && isString(left))) {
          context.report({ node, messageId: "named" });
        }
      },
    };
  },
};
