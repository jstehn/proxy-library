// What the module root uses of catalog/rules (ADR 0030): the Comprehensive Rules, their sync and
// the lookup of a card's rulings and interactions.
export { lookupRules } from "./queries/rules";
export {
  makeRulesLookup,
  type CardInteractions,
  type CardRulings,
  type RulesCardNotFound,
} from "./application/rules-lookup";
export { makeComprehensiveRulesSync } from "./application/rules";
export type { RulesDependencies, RulesServices } from "./application/ports";
