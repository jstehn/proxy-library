// The table of the catalog module's rules area (design doc 60).
import { index, pgTable, text } from "drizzle-orm/pg-core";
import { pgVector, timestamptz } from "@/shared/db";

/** Official MTG Comprehensive Rules with pgvector embeddings (design doc 60). */
export const comprehensiveRules = pgTable(
  "comprehensive_rules",
  {
    ruleNumber: text("rule_number").primaryKey(),
    kind: text("kind").notNull(),
    section: text("section").notNull(),
    parentNumber: text("parent_number"),
    title: text("title"),
    text: text("text").notNull(),
    crVersion: text("cr_version").notNull(),
    embedding: pgVector(384)("embedding").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    index("comprehensive_rules_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    index("comprehensive_rules_parent_idx").on(table.parentNumber),
  ],
);
