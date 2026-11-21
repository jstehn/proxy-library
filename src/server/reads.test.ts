import { describe, expect, it } from "vitest";
import { testActor } from "@/modules/accounts/testing/actors";
import type { DbExecutor } from "@/shared/db";
import { buildReads } from "./reads";

// `reads` is each module's query namespace with the database filled in. A fake database that
// remembers what it was asked shows the binding works through the real module namespaces.

function recordingDatabase() {
  const asked: string[] = [];
  const db = {
    execute: async (query: { queryChunks?: unknown[] }) => {
      asked.push(JSON.stringify(query.queryChunks ?? []).slice(0, 40));
      return { rows: [] };
    },
  } as unknown as DbExecutor;
  return { db, asked };
}

describe("buildReads", () => {
  it("has a namespace per module, each query without its database argument", async () => {
    const { db, asked } = recordingDatabase();
    const reads = buildReads(db);
    expect(Object.keys(reads.activity)).toEqual(["feed"]);
    expect(await reads.activity.feed(testActor(), { limit: 5 })).toEqual([]);
    expect(asked).toHaveLength(1);
  });
});
