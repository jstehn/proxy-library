import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { RuleKind } from "../domain/comprehensive-rules";
import type { LookupRulesResult, RuleSearchHit } from "../domain/rules-search";

export type { LookupRulesResult, RuleSearchHit };

const RRF_K = 60;
const CANDIDATE_LIMIT = 30;
const LEADING_RULE_NUMBER_RE = /^(\d{3}(?:\.\d+[a-z]?)?)(?:\s+.*)?$/i;

type RuleRow = {
  rule_number: string;
  kind: RuleKind;
  section: string;
  parent_number: string | null;
  title: string | null;
  text: string;
  cr_version: string;
  score?: number;
};

function toHit(row: RuleRow, score: number): RuleSearchHit {
  return {
    ruleNumber: row.rule_number,
    kind: row.kind,
    section: row.section,
    parentNumber: row.parent_number,
    title: row.title,
    text: row.text,
    crVersion: row.cr_version,
    score: Math.round(score * 10_000) / 10_000,
  };
}

/**
 * Hybrid Comprehensive Rules lookup (design doc 60):
 * 1. Exact/prefix rule-number lookup when `query` looks like a rule number (e.g. `702.19a`).
 * 2. Reciprocal Rank Fusion (RRF) combining PostgreSQL `tsvector` FTS and `pgvector` cosine similarity.
 */
export async function lookupRules(
  db: DbExecutor,
  embedder: (texts: readonly string[]) => Promise<number[][]>,
  options: { query: string; limit?: number },
): Promise<LookupRulesResult> {
  const trimmed = options.query.trim();
  const limit = Math.max(1, Math.min(20, options.limit ?? 8));
  if (!trimmed) return { crVersion: null, hits: [] };

  const leadingRule = trimmed.match(LEADING_RULE_NUMBER_RE)?.[1];
  if (leadingRule) {
    const normalized = leadingRule.toLowerCase();
    const prefix = `${normalized}%`;
    const ruleLimit = Math.max(limit, 12);
    const rows = (
      await db.execute<RuleRow>(sql`
        select rule_number, kind, section, parent_number, title, text, cr_version
          from comprehensive_rules
         where rule_number = ${normalized}
            or parent_number = ${normalized}
            or rule_number like ${prefix}
         order by (rule_number = ${normalized}) desc, rule_number asc
         limit ${ruleLimit}
      `)
    ).rows;
    if (rows.length > 0) {
      return {
        crVersion: rows[0].cr_version,
        hits: rows.map((r, idx) => toHit(r, 1 / (idx + 1))),
      };
    }
  }

  const [queryVec] = await embedder([trimmed]);
  if (!queryVec || queryVec.length === 0) return { crVersion: null, hits: [] };
  const vecLiteral = `[${queryVec.join(",")}]`;

  const [ftsRes, vecRes] = await Promise.all([
    db.execute<RuleRow>(sql`
      select rule_number, kind, section, parent_number, title, text, cr_version
        from comprehensive_rules
       where to_tsvector('english', coalesce(title, '') || ' ' || text) @@ websearch_to_tsquery('english', ${trimmed})
       order by ts_rank_cd(
         to_tsvector('english', coalesce(title, '') || ' ' || text),
         websearch_to_tsquery('english', ${trimmed})
       ) desc
       limit ${CANDIDATE_LIMIT}
    `),
    db.execute<RuleRow>(sql`
      select rule_number, kind, section, parent_number, title, text, cr_version
        from comprehensive_rules
       order by embedding <=> ${vecLiteral}::vector
       limit ${CANDIDATE_LIMIT}
    `),
  ]);

  const byId = new Map<string, { row: RuleRow; rrf: number }>();
  ftsRes.rows.forEach((row, idx) => {
    const rrf = 1 / (RRF_K + idx + 1);
    byId.set(row.rule_number, { row, rrf });
  });
  vecRes.rows.forEach((row, idx) => {
    const add = 1 / (RRF_K + idx + 1);
    const existing = byId.get(row.rule_number);
    if (existing) existing.rrf += add;
    else byId.set(row.rule_number, { row, rrf: add });
  });

  const ranked = [...byId.values()].sort((a, b) => b.rrf - a.rrf).slice(0, limit);

  return {
    crVersion: ranked[0]?.row.cr_version ?? null,
    hits: ranked.map((entry) => toHit(entry.row, entry.rrf)),
  };
}
