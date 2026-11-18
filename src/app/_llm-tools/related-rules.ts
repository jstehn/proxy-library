export interface RelatedRuleMatch {
  rule: string;
  title: string;
  reason: string;
}

const RULE_PATTERNS: ReadonlyArray<{
  rule: string;
  title: string;
  reason: string;
  pattern: RegExp;
}> = [
  {
    rule: "CR 513",
    title: "End Step & Delayed Triggers",
    reason: "References end step or delayed 'next end step' trigger timing.",
    pattern: /\b(?:next\s+end\s+step|beginning\s+of\s+(?:the|each|your)\s+end\s+step)\b/i,
  },
  {
    rule: "CR 118.9",
    title: "Alternative Costs",
    reason:
      "Uses or references an alternative casting cost (e.g. blitz, evoke, overload, rather than pay).",
    pattern: /\b(?:rather\s+than\s+pay|alternative\s+cost|blitz|evoke|overload|dash|miracle)\b/i,
  },
  {
    rule: "CR 400.7",
    title: "Zone Changes & New Objects",
    reason: "Moves objects between zones or tracks dies/leaves-the-battlefield triggers.",
    pattern:
      /\b(?:leaves\s+the\s+battlefield|when(?:ever)?\s+.*\bdies\b|put\s+into\s+a\s+graveyard\s+from\s+anywhere|return\s+.*\s+from\s+your\s+graveyard)\b/i,
  },
  {
    rule: "CR 614",
    title: "Replacement Effects",
    reason: "Modifies how an event occurs using 'instead' or 'would'.",
    pattern: /\binstead\b|\bif\s+[^.]+\bwould\b/i,
  },
  {
    rule: "CR 601.2",
    title: "Casting Spells & Permissions",
    reason: "Grants permission to cast spells from non-hand zones or with modified timing.",
    pattern:
      /\b(?:cast|play)\b[^.]*\bfrom\s+(?:the\s+top\s+of\s+your\s+library|your\s+graveyard|exile)\b/i,
  },
];

export function matchRelatedRules(oracleText: string | null | undefined): RelatedRuleMatch[] {
  if (!oracleText) return [];
  const matches: RelatedRuleMatch[] = [];
  for (const entry of RULE_PATTERNS) {
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
