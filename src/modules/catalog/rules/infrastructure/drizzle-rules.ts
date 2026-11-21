import type { DbExecutor } from "@/shared/db";
import type { ComprehensiveRuleRow, ComprehensiveRulesRepository } from "../application/ports";
import { comprehensiveRules } from "./schema";

const INSERT_CHUNK_SIZE = 200;

export function drizzleComprehensiveRulesRepository(db: DbExecutor): ComprehensiveRulesRepository {
  return {
    async currentVersion() {
      const [row] = await db
        .select({ crVersion: comprehensiveRules.crVersion })
        .from(comprehensiveRules)
        .limit(1);
      return row?.crVersion ?? null;
    },

    async replaceAll(rows: readonly ComprehensiveRuleRow[], syncedAt: Date) {
      await db.delete(comprehensiveRules);
      for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
        const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
        await db.insert(comprehensiveRules).values(
          chunk.map((r) => ({
            ruleNumber: r.ruleNumber,
            kind: r.kind,
            section: r.section,
            parentNumber: r.parentNumber,
            title: r.title,
            text: r.text,
            crVersion: r.crVersion,
            embedding: r.embedding,
            updatedAt: syncedAt,
          })),
        );
      }
    },
  };
}
