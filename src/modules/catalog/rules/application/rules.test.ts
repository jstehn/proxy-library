import { describe, expect, it } from "vitest";
import { type Clock, type UnitOfWork } from "@/shared/kernel";
import type {
  RulesDependencies,
  RulesServices,
  ComprehensiveRuleRow,
  ComprehensiveRulesGateway,
  ComprehensiveRulesRepository,
} from "./ports";
import { makeComprehensiveRulesSync } from "./rules";

const SAMPLE_CR = `Magic: The Gathering Comprehensive Rules

These rules are effective as of September 1, 2026.

100. General

100.1. These Magic rules apply to any Magic game with two or more players.

100.1a A two-player game is a game that begins with only two players.
`;

function fakeDependencies(initialVersion: string | null) {
  let storedVersion = initialVersion;
  let storedRows: readonly ComprehensiveRuleRow[] = [];

  const repo: ComprehensiveRulesRepository = {
    async currentVersion() {
      return storedVersion;
    },
    async replaceAll(rows) {
      storedRows = rows;
      storedVersion = rows[0]?.crVersion ?? null;
    },
  };

  const gateway: ComprehensiveRulesGateway = {
    async fetchLatestRulesText() {
      return { sourceUrl: "https://example.com/cr.txt", text: SAMPLE_CR };
    },
  };

  const unitOfWork: UnitOfWork<RulesServices> = {
    async run(work) {
      return work({
        comprehensiveRules: repo,
      });
    },
  };

  const clock: Clock = { now: () => new Date("2026-09-02T00:00:00Z") };
  const textEmbedder = async (texts: readonly string[]) =>
    texts.map((_, i) => Array.from({ length: 384 }, () => (i + 1) * 0.01));

  const deps = {
    unitOfWork,
    clock,
    comprehensiveRules: gateway,
    textEmbedder,
  } as unknown as RulesDependencies;

  return {
    sync: makeComprehensiveRulesSync(deps),
    getStoredRows: () => storedRows,
    getStoredVersion: () => storedVersion,
  };
}

describe("syncComprehensiveRules", () => {
  it("parses, embeds, and stores rules when missing", async () => {
    const { sync, getStoredRows, getStoredVersion } = fakeDependencies(null);
    const summary = await sync.syncComprehensiveRules();
    expect(summary.skipped).toBe(false);
    expect(summary.version).toBe("2026-09-01");
    expect(summary.ruleCount).toBe(2);
    expect(summary.embeddedCount).toBe(2);
    expect(getStoredVersion()).toBe("2026-09-01");
    expect(getStoredRows()).toHaveLength(2);
  });

  it("skips embedding when version already matches unless forced", async () => {
    const { sync } = fakeDependencies("2026-09-01");
    const skipped = await sync.syncComprehensiveRules();
    expect(skipped.skipped).toBe(true);
    expect(skipped.embeddedCount).toBe(0);

    const forced = await sync.syncComprehensiveRules({ force: true });
    expect(forced.skipped).toBe(false);
    expect(forced.embeddedCount).toBe(2);
  });
});
