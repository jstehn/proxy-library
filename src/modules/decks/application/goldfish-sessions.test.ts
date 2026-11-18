import { describe, expect, it } from "vitest";
import { seededRng, UserId, type Clock, type UnitOfWork } from "@/shared/kernel";
import { DeckId } from "../domain/deck";
import type { GoldfishDeckLine } from "../domain/goldfish-session";
import {
  GOLDFISH_SESSION_TTL_MS,
  makeGoldfishSessions,
  MAX_GOLDFISH_SESSIONS_PER_USER,
} from "./goldfish-sessions";
import type {
  GoldfishSessionRecord,
  GoldfishSessionRepository,
  GoldfishSessionsServices,
} from "./ports";

function fakeSessionRepo(): GoldfishSessionRepository & {
  records: Map<string, GoldfishSessionRecord>;
} {
  const records = new Map<string, GoldfishSessionRecord>();
  return {
    records,
    async create(record) {
      records.set(record.id, record);
    },
    async findById(id, userId, now) {
      const found = records.get(id);
      if (!found || found.userId !== userId || found.expiresAt.getTime() <= now.getTime()) {
        return null;
      }
      return found;
    },
    async save(id, userId, state, updatedAt, expiresAt) {
      const existing = records.get(id);
      if (!existing || existing.userId !== userId) return;
      records.set(id, { ...existing, state, updatedAt, expiresAt });
    },
    async pruneExpired(now) {
      let deleted = 0;
      for (const [id, rec] of records.entries()) {
        if (rec.expiresAt.getTime() <= now.getTime()) {
          records.delete(id);
          deleted++;
        }
      }
      return deleted;
    },
    async enforceUserCap(userId, maxSessions) {
      const userRecs = [...records.values()]
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      let deleted = 0;
      for (const rec of userRecs.slice(maxSessions)) {
        records.delete(rec.id);
        deleted++;
      }
      return deleted;
    },
  };
}

function sampleLines(): GoldfishDeckLine[] {
  return [
    {
      oracleId: "island",
      name: "Island",
      printingId: "p-island",
      board: "main",
      quantity: 20,
      typeLine: "Basic Land — Island",
      manaValue: 0,
      producedMana: ["U"],
    },
  ];
}

describe("goldfish-sessions application", () => {
  it("creates, steps, and expires sessions after TTL", async () => {
    let nowMs = 1_700_000_000_000;
    const clock: Clock = { now: () => new Date(nowMs) };
    const repo = fakeSessionRepo();
    const unitOfWork: UnitOfWork<GoldfishSessionsServices> = {
      async run(work) {
        return work({ goldfishSessions: repo });
      },
    };
    let seq = 0;
    const sessions = makeGoldfishSessions({
      unitOfWork,
      clock,
      newSessionId: () => `sess-${++seq}`,
    });

    const userId = UserId.of("u-1");
    const started = await sessions.start({
      userId,
      deckId: DeckId.of(10),
      format: "commander",
      lines: sampleLines(),
      rng: seededRng("1"),
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.sessionId).toBe("sess-1");

    const stepped = await sessions.step({
      userId,
      sessionId: "sess-1",
      step: { kind: "action", action: { kind: "next_turn" } },
    });
    expect(stepped.ok).toBe(true);
    if (!stepped.ok) return;
    expect(stepped.value.state.turn).toBe(1);

    // Advance past 24h TTL
    nowMs += GOLDFISH_SESSION_TTL_MS + 1;
    const expired = await sessions.step({
      userId,
      sessionId: "sess-1",
      step: { kind: "action", action: { kind: "next_turn" } },
    });
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.error.kind).toBe("SessionNotFound");
  });

  it("enforces per-user session cap and prunes expired rows on start", async () => {
    let nowMs = 1_700_000_000_000;
    const clock: Clock = { now: () => new Date(nowMs) };
    const repo = fakeSessionRepo();
    const unitOfWork: UnitOfWork<GoldfishSessionsServices> = {
      async run(work) {
        return work({ goldfishSessions: repo });
      },
    };
    let seq = 0;
    const sessions = makeGoldfishSessions({
      unitOfWork,
      clock,
      newSessionId: () => `sess-${++seq}`,
    });
    const userId = UserId.of("u-1");

    for (let i = 0; i < MAX_GOLDFISH_SESSIONS_PER_USER + 3; i++) {
      nowMs += 1000;
      await sessions.start({
        userId,
        deckId: DeckId.of(10),
        format: "commander",
        lines: sampleLines(),
        rng: seededRng(`cap-${i}`),
      });
    }
    expect(repo.records.size).toBe(MAX_GOLDFISH_SESSIONS_PER_USER);
  });
});
