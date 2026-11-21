import type { Bracket, BracketRuleReason, Format, TargetedTag } from "@/modules/decks/core/client";
import type { CardCastability, GoldfishReport } from "@/modules/decks/play/client";
import type { DeckScore } from "@/modules/decks/scoring/client";

// What the one-shot deck audit reports (legality, bracket, roles, mana, ownership, goldfish).
// `queries/audit.ts` builds it; the types live here so the application layer can name them.

export type AuditFinding = Readonly<{
  severity: "error" | "warning" | "info";
  area: "legality" | "bracket" | "mana" | "roles" | "goldfish" | "ownership";
  message: string;
}>;

export type AuditRoleStatus = Readonly<{
  tag: TargetedTag;
  count: number;
  target: number;
  deficit: number;
}>;

export type DeckAuditReport = Readonly<{
  deck: {
    id: number;
    name: string;
    format: Format;
    targetBracket: Bracket | null;
    cardCount: number;
    sideboardCount: number;
  };
  score: DeckScore;
  legality: {
    problemCount: number;
    problems: readonly string[];
  };
  bracket: {
    target: Bracket | null;
    floor: Bracket;
    overTarget: boolean;
    gameChangers: number;
    twoCardCombos: number;
    reasons: readonly BracketRuleReason[];
  } | null;
  roles: readonly AuditRoleStatus[];
  mana: {
    lands: number;
    suggestedLands: number;
    averageManaValue: number;
    underservedColors: readonly string[];
    averageCastOnCurvePct: number;
    strugglingSpells: readonly CardCastability[];
  };
  ownership: {
    ownedCards: number;
    missingCards: number;
    estimatedMissingCents: number;
  };
  goldfish: GoldfishReport;
  findings: readonly AuditFinding[];
}>;
