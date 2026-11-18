import { ok } from "@/shared/kernel";
import { parseComprehensiveRules, ruleEmbeddingText } from "../domain/comprehensive-rules";
import type { CatalogDependencies, CatalogServices, ComprehensiveRuleRow } from "./ports";

// Keep batches small so ONNX padding on long rules doesn't spike RAM on constrained hosts.
const EMBED_BATCH_SIZE = 8;

export type ComprehensiveRulesSyncSummary = Readonly<{
  skipped: boolean;
  version: string;
  ruleCount: number;
  embeddedCount: number;
}>;

export function makeComprehensiveRulesSync(dependencies: CatalogDependencies) {
  const { unitOfWork, clock, comprehensiveRules: gateway, textEmbedder } = dependencies;

  async function inTransaction<T>(work: (services: CatalogServices) => Promise<T>): Promise<T> {
    const result = await unitOfWork.run<T, never>(async (services) => ok(await work(services)));
    if (!result.ok) throw new Error("unreachable");
    return result.value;
  }

  async function syncComprehensiveRules(options?: {
    force?: boolean;
  }): Promise<ComprehensiveRulesSyncSummary> {
    if (!gateway || !textEmbedder) {
      return { skipped: true, version: "unconfigured", ruleCount: 0, embeddedCount: 0 };
    }

    const { text } = await gateway.fetchLatestRulesText();
    const parsed = parseComprehensiveRules(text);
    const existingVersion = await inTransaction(({ comprehensiveRules }) =>
      comprehensiveRules ? comprehensiveRules.currentVersion() : Promise.resolve(null),
    );

    if (!options?.force && existingVersion === parsed.version && parsed.version !== "unknown") {
      return { skipped: true, version: parsed.version, ruleCount: 0, embeddedCount: 0 };
    }

    const now = clock.now();
    const rows: ComprehensiveRuleRow[] = [];
    for (let i = 0; i < parsed.rules.length; i += EMBED_BATCH_SIZE) {
      const batch = parsed.rules.slice(i, i + EMBED_BATCH_SIZE);
      const embeddings = await textEmbedder(batch.map(ruleEmbeddingText));
      for (let j = 0; j < batch.length; j++) {
        rows.push({
          ...batch[j],
          crVersion: parsed.version,
          embedding: embeddings[j],
          updatedAt: now,
        });
      }
    }

    await inTransaction(async ({ comprehensiveRules }) => {
      if (comprehensiveRules) await comprehensiveRules.replaceAll(rows, now);
    });

    return {
      skipped: false,
      version: parsed.version,
      ruleCount: parsed.rules.length,
      embeddedCount: rows.length,
    };
  }

  return { syncComprehensiveRules };
}
