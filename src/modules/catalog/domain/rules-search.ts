import type { RuleKind } from "./comprehensive-rules";

// What a Comprehensive Rules search returns.

export type RuleSearchHit = Readonly<{
  ruleNumber: string;
  kind: RuleKind;
  section: string;
  parentNumber: string | null;
  title: string | null;
  text: string;
  crVersion: string;
  score: number;
}>;

export type LookupRulesResult = Readonly<{
  crVersion: string | null;
  hits: readonly RuleSearchHit[];
}>;
