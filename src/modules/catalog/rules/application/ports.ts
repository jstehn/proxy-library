import type { Clock, UnitOfWork } from "@/shared/kernel";
import type { TextEmbedder } from "../../outside";
import type { ParsedRule } from "../domain/comprehensive-rules";

// Ports: what the rules area needs from outside (design doc 60).

/** Official Wizards Comprehensive Rules gateway (design doc 60, ADR 0007). */
export interface ComprehensiveRulesGateway {
  fetchLatestRulesText(): Promise<{ sourceUrl: string; text: string }>;
}

export type ComprehensiveRuleRow = ParsedRule &
  Readonly<{
    crVersion: string;
    embedding: number[];
    updatedAt: Date;
  }>;

export interface ComprehensiveRulesRepository {
  currentVersion(): Promise<string | null>;
  replaceAll(rows: readonly ComprehensiveRuleRow[], syncedAt: Date): Promise<void>;
}

export type RulesServices = { comprehensiveRules?: ComprehensiveRulesRepository };

export type RulesDependencies = {
  unitOfWork: UnitOfWork<RulesServices>;
  comprehensiveRules?: ComprehensiveRulesGateway;
  textEmbedder?: TextEmbedder;
  clock: Clock;
};
