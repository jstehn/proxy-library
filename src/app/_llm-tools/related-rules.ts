export type RuleRelationship =
  "overrides" | "blocked_by" | "synergizes" | "triggers" | "depends_on";

export interface RuleInteractionEdge {
  rule: string;
  relationship: RuleRelationship;
  note: string;
}

export interface RuleDefinition {
  rule: string;
  title: string;
  reason: string;
  pattern: RegExp;
  interactsWith: readonly RuleInteractionEdge[];
}

export interface RelatedRuleMatch {
  rule: string;
  title: string;
  reason: string;
}

export interface RuleInteractionMatch {
  fromRule: string;
  fromTitle: string;
  toRule: string;
  toTitle: string;
  relationship: RuleRelationship;
  note: string;
  fromCards: string[];
  toCards: string[];
}

export const RULE_GRAPH: ReadonlyArray<RuleDefinition> = [
  {
    rule: "CR 513",
    title: "End Step & Delayed Triggers",
    reason: "References end step or delayed 'next end step' trigger timing.",
    pattern: /\b(?:next\s+end\s+step|beginning\s+of\s+(?:the|each|your)\s+end\s+step)\b/i,
    interactsWith: [
      {
        rule: "CR 400.7",
        relationship: "depends_on",
        note: "Delayed end-step triggers lose track of an object if it changes zones before the end step (CR 400.7).",
      },
    ],
  },
  {
    rule: "CR 118.9",
    title: "Alternative Costs",
    reason:
      "Uses or references an alternative casting cost (e.g. blitz, evoke, overload, rather than pay).",
    pattern: /\b(?:rather\s+than\s+pay|alternative\s+cost|blitz|evoke|overload|dash|miracle)\b/i,
    interactsWith: [
      {
        rule: "CR 513",
        relationship: "triggers",
        note: "Alternative-cost mechanics like blitz and dash create delayed end-step sacrifice/return triggers (CR 513).",
      },
      {
        rule: "CR 601.2",
        relationship: "blocked_by",
        note: "Only one alternative cost may be applied to a spell when casting from any zone (CR 118.9a / CR 601.2).",
      },
    ],
  },
  {
    rule: "CR 400.7",
    title: "Zone Changes & New Objects",
    reason: "Moves objects between zones or tracks dies/leaves-the-battlefield triggers.",
    pattern:
      /\b(?:leaves\s+the\s+battlefield|when(?:ever)?\s+.*\bdies\b|put\s+into\s+(?:a|your|an\s+opponent's)\s+graveyard\s+from\s+(?:anywhere|the\s+battlefield)|return\s+.*\s+from\s+(?:your|a)\s+graveyard)\b/i,
    interactsWith: [
      {
        rule: "CR 513",
        relationship: "triggers",
        note: "Zone-change replacement or return effects can interact with delayed end-step triggers.",
      },
    ],
  },
  {
    rule: "CR 702.61a",
    title: "Split Second",
    reason:
      "While a spell with split second is on the stack, players can't cast spells or activate abilities that aren't mana abilities. Mana abilities (CR 605.1a) and triggered abilities still work.",
    pattern: /\bsplit\s+second\b/i,
    interactsWith: [],
  },
  {
    rule: "CR 605.1a",
    title: "Mana Abilities (Beat Split Second)",
    reason:
      "Activated mana ability (adds mana, no target, not a loyalty ability): does not use the stack and CAN be activated while a spell with split second (CR 702.61a) is on the stack.",
    pattern: /^(?!.*\btarget\b)[^:\n]*:\s*add\b/im,
    interactsWith: [
      {
        rule: "CR 702.61a",
        relationship: "overrides",
        note: "Mana abilities do not use the stack and CAN still be activated while a split second spell is on the stack.",
      },
    ],
  },
  {
    rule: "CR 602.2",
    title: "Non-Mana Activated Abilities (Blocked by Split Second)",
    reason:
      "Non-mana sacrifice/activated ability: uses the stack and CANNOT be activated while a spell with split second (CR 702.61a) is on the stack.",
    pattern: /\bsacrifice\s+(?:a|another|this)\b[^:\n]*:(?!\s*add\b)/i,
    interactsWith: [
      {
        rule: "CR 702.61a",
        relationship: "blocked_by",
        note: "Non-mana activated abilities use the stack and CANNOT be activated while a split second spell is on the stack.",
      },
    ],
  },
  {
    rule: "CR 614",
    title: "Replacement Effects",
    reason: "Modifies how an event occurs using 'instead' or 'would'.",
    pattern: /\binstead\b|\bif\s+[^.]+\bwould\b/i,
    interactsWith: [
      {
        rule: "CR 400.7",
        relationship: "overrides",
        note: "Replacement effects modify zone transitions before they happen, preventing dies/leaves triggers if the destination changes.",
      },
    ],
  },
  {
    rule: "CR 601.2",
    title: "Casting Spells & Permissions",
    reason: "Grants permission to cast spells from non-hand zones or with modified timing.",
    pattern:
      /\b(?:cast|play)\b[^.]*\bfrom\s+(?:the\s+top\s+of\s+your\s+library|your\s+graveyard|exile)\b/i,
    interactsWith: [
      {
        rule: "CR 118.9",
        relationship: "synergizes",
        note: "Zone-cast permissions combine with alternative costs when only one alternative cost is chosen.",
      },
    ],
  },
  {
    rule: "CR 702.85",
    title: "Cascade",
    reason:
      "Exiles from top of library until a cheaper nonland card and casts it without paying its mana cost.",
    pattern: /\bcascade\b/i,
    interactsWith: [
      {
        rule: "CR 118.9",
        relationship: "blocked_by",
        note: "Cascade casts without paying mana cost (CR 118.9a alternative cost), so another alternative cost cannot be chosen, though additional costs like Commander tax still apply (CR 601.2f).",
      },
    ],
  },
];

const RULE_BY_ID = new Map<string, RuleDefinition>(RULE_GRAPH.map((r) => [r.rule, r]));

export function matchRelatedRules(
  oracleText: string | null | undefined,
  rules: readonly RuleDefinition[] = RULE_GRAPH,
): RelatedRuleMatch[] {
  if (!oracleText) return [];
  const matches: RelatedRuleMatch[] = [];
  for (const entry of rules) {
    if (entry.pattern.test(oracleText)) {
      matches.push({ rule: entry.rule, title: entry.title, reason: entry.reason });
    }
  }
  return matches;
}

export function findSharedRules(
  perCard: ReadonlyArray<{ name: string; relatedRules: readonly RelatedRuleMatch[] }>,
): Array<{ rule: string; title: string; cards: string[] }> {
  const byRule = new Map<string, { title: string; cards: Set<string> }>();
  for (const card of perCard) {
    for (const r of card.relatedRules) {
      let bucket = byRule.get(r.rule);
      if (!bucket) {
        bucket = { title: r.title, cards: new Set() };
        byRule.set(r.rule, bucket);
      }
      bucket.cards.add(card.name);
    }
  }
  const shared: Array<{ rule: string; title: string; cards: string[] }> = [];
  for (const [rule, bucket] of byRule.entries()) {
    if (bucket.cards.size >= 2) {
      shared.push({ rule, title: bucket.title, cards: [...bucket.cards] });
    }
  }
  return shared;
}

/**
 * Traverses `interactsWith` edges across rules matched on the given cards to surface
 * cross-rule interactions (e.g. CR 605.1a mana abilities overriding CR 702.61a split second).
 */
export function findRuleInteractions(
  perCard: ReadonlyArray<{ name: string; relatedRules: readonly RelatedRuleMatch[] }>,
  rules: readonly RuleDefinition[] = RULE_GRAPH,
): RuleInteractionMatch[] {
  const byId = rules === RULE_GRAPH ? RULE_BY_ID : new Map(rules.map((r) => [r.rule, r]));
  const cardsByRule = new Map<string, Set<string>>();
  for (const card of perCard) {
    for (const r of card.relatedRules) {
      let set = cardsByRule.get(r.rule);
      if (!set) {
        set = new Set();
        cardsByRule.set(r.rule, set);
      }
      set.add(card.name);
    }
  }

  const interactions: RuleInteractionMatch[] = [];
  for (const [fromRule, fromCards] of cardsByRule.entries()) {
    const def = byId.get(fromRule);
    if (!def) continue;
    for (const edge of def.interactsWith) {
      const toCards = cardsByRule.get(edge.rule);
      if (!toCards || toCards.size === 0) continue;
      // Only surface if at least two distinct cards are involved across the two rules
      const combined = new Set([...fromCards, ...toCards]);
      if (combined.size < 2) continue;
      const toDef = byId.get(edge.rule);
      interactions.push({
        fromRule: def.rule,
        fromTitle: def.title,
        toRule: edge.rule,
        toTitle: toDef?.title ?? edge.rule,
        relationship: edge.relationship,
        note: edge.note,
        fromCards: [...fromCards],
        toCards: [...toCards],
      });
    }
  }
  return interactions;
}
