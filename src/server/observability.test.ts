import { Pool, type PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createDatabase, type QueryTimingEvent } from "@/shared/db";
import {
  formatServerTiming,
  hasActiveMetrics,
  openMetricStore,
  recentMetricEntries,
  recordHttpEvent,
  recordQueryEvent,
  registerFallbackMetricStore,
  resolveActionLabel,
  runWithMetrics,
  setMetricClient,
  setMetricLabel,
  setMetricsLogging,
  wrapObservedAction,
  type MetricStore,
} from "./observability";

afterEach(() => {
  registerFallbackMetricStore(null);
  setMetricsLogging(true);
  vi.restoreAllMocks();
});

describe("observability", () => {
  it("finds the statement that ran most often, whatever values it ran with", async () => {
    const { snapshot } = await runWithMetrics(
      { kind: "page", label: "page:/decks", log: false },
      async () => {
        for (const deckId of [1, 2, 3, 4]) {
          recordQueryEvent({
            durationMs: 1,
            sql: `SELECT *  FROM cards WHERE deck_id = ${deckId} AND name IN ('a', 'b')`,
            isTransactionControl: false,
          });
        }
        recordQueryEvent({ durationMs: 1, sql: "SELECT 1", isTransactionControl: false });
        recordQueryEvent({ durationMs: 1, sql: "COMMIT", isTransactionControl: true });
      },
    );

    expect(snapshot.repeatedSqlCount).toBe(4);
    expect(snapshot.repeatedSql).toBe("SELECT * FROM cards WHERE deck_id = ? AND name IN (?, …)");
  });

  it("records who called, trimmed, and ignores it outside an operation", async () => {
    expect(() => setMetricClient("nobody")).not.toThrow();
    const { snapshot } = await runWithMetrics(
      { kind: "mcp", label: "mcp:initialize", log: false },
      async () => {
        setMetricClient("claude-code");
        setMetricClient("x".repeat(200));
        setMetricClient("");
      },
    );
    expect(snapshot.client).toBe("x".repeat(80));
  });

  it("leaves repeatedSql empty when no statement ran twice", async () => {
    const { snapshot } = await runWithMetrics(
      { kind: "page", label: "page:/", log: false },
      async () => {
        recordQueryEvent({ durationMs: 1, sql: "SELECT 1", isTransactionControl: false });
        recordQueryEvent({
          durationMs: 1,
          sql: "SELECT 2 FROM cards",
          isTransactionControl: false,
        });
      },
    );
    expect(snapshot).toMatchObject({ repeatedSql: null, repeatedSqlCount: 0 });
  });

  it("counts queries that overlap once in otherMs", async () => {
    const { snapshot } = await runWithMetrics(
      { kind: "page", label: "page:/overlap", log: false },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        // Two queries that both took 30 ms and ended together (they ran in parallel).
        recordQueryEvent({ durationMs: 30, sql: "SELECT 1", isTransactionControl: false });
        recordQueryEvent({ durationMs: 30, sql: "SELECT 2", isTransactionControl: false });
      },
    );
    expect(snapshot.sqlMs).toBe(60);
    // Wall time is about 40 ms; the two queries overlap, so only 30 ms of it was waiting. Adding
    // them up (60 ms) would have left nothing for "other".
    expect(snapshot.otherMs).toBeGreaterThan(0);
    expect(snapshot.otherMs).toBeLessThan(snapshot.wallMs - 25);
    expect(snapshot.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records queries into a fallback metric store and lets runWithMetrics take precedence", async () => {
    setMetricsLogging(false);
    const slot: { store: MetricStore | undefined } = { store: undefined };
    registerFallbackMetricStore(() => slot.store);

    expect(hasActiveMetrics()).toBe(false);
    const opened = openMetricStore({ kind: "page", label: "page:/started" });
    slot.store = opened.store;
    expect(hasActiveMetrics()).toBe(true);

    // Simulates a caller continuing after `await readPage()` resolves.
    await Promise.resolve();
    recordQueryEvent({ durationMs: 2, sql: "SELECT 1", isTransactionControl: false });
    opened.setLabel("page:/renamed");

    // An explicit `runWithMetrics` (e.g. a Server Action) isolates its queries from the fallback.
    const { snapshot: nested } = await runWithMetrics(
      { kind: "action", label: "action:nested", log: false },
      async () => {
        recordQueryEvent({ durationMs: 3, sql: "SELECT 2", isTransactionControl: false });
      },
    );
    expect(nested.sqlCount).toBe(1);

    const entry = opened.finish();
    expect(entry).toMatchObject({
      kind: "page",
      label: "page:/renamed",
      sqlCount: 1,
    });
    expect(recentMetricEntries()[0]).toEqual(entry);
  });

  it("isolates metrics across concurrent AsyncLocalStorage runs", async () => {
    const [first, second] = await Promise.all([
      runWithMetrics({ kind: "tool", label: "tool:first", log: false }, async () => {
        recordQueryEvent({
          durationMs: 12.34,
          sql: "SELECT   *\n  FROM  cards",
          isTransactionControl: false,
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        recordHttpEvent({ host: "api.scryfall.com", durationMs: 25.12, status: 200 });
        return "one";
      }),
      runWithMetrics({ kind: "mcp", label: "mcp:initial", log: false }, async () => {
        setMetricLabel("mcp:tools/call:get_deck");
        recordQueryEvent({ durationMs: 0.8, sql: "BEGIN", isTransactionControl: true });
        recordQueryEvent({
          durationMs: 4.2,
          sql: "SELECT id FROM decks",
          isTransactionControl: false,
        });
        recordQueryEvent({ durationMs: 0.6, sql: "COMMIT", isTransactionControl: true });
        return "two";
      }),
    ]);

    expect(first.result).toBe("one");
    expect(first.snapshot).toMatchObject({
      kind: "tool",
      label: "tool:first",
      sqlCount: 1,
      sqlMs: 12.3,
      sqlMaxMs: 12.3,
      txCount: 0,
      slowestSql: "SELECT * FROM cards",
      httpCount: 1,
      httpMs: 25.1,
      httpHosts: ["api.scryfall.com"],
    });

    expect(second.result).toBe("two");
    expect(second.snapshot).toMatchObject({
      kind: "mcp",
      label: "mcp:tools/call:get_deck",
      sqlCount: 3,
      sqlMs: 5.6,
      sqlMaxMs: 4.2,
      txCount: 2,
      slowestSql: "SELECT id FROM decks",
      httpCount: 0,
      httpMs: 0,
      httpHosts: [],
    });
  });

  it("ignores query, http, and label calls outside an active runWithMetrics scope", () => {
    expect(() => {
      recordQueryEvent({ durationMs: 5, sql: "SELECT 1", isTransactionControl: false });
      recordHttpEvent({ host: "example.com", durationMs: 5, status: 200 });
      setMetricLabel("ignored");
    }).not.toThrow();
  });

  it("collapses whitespace and truncates slowestSql to 160 characters", async () => {
    const longSql = `SELECT ${"column_name, ".repeat(20)}FROM printings`;
    const { snapshot } = await runWithMetrics(
      { kind: "action", label: "action:long", log: false },
      async () => {
        recordQueryEvent({ durationMs: 1, sql: "SELECT 1", isTransactionControl: false });
        recordQueryEvent({
          durationMs: 20,
          sql: `  ${longSql}  \n  WHERE id = 1 `,
          isTransactionControl: false,
        });
      },
    );

    expect(snapshot.slowestSql?.length).toBe(160);
    expect(snapshot.slowestSql?.includes("\n")).toBe(false);
    expect(snapshot.slowestSql?.startsWith("SELECT column_name,")).toBe(true);
  });

  it("deduplicates httpHosts and formats Server-Timing headers", async () => {
    const { snapshot } = await runWithMetrics(
      { kind: "tool", label: "tool:search", log: false },
      async () => {
        recordQueryEvent({ durationMs: 10.1, sql: "SELECT 1", isTransactionControl: false });
        recordQueryEvent({ durationMs: 8.2, sql: "SELECT 2", isTransactionControl: false });
        recordHttpEvent({ host: "json.edhrec.com", durationMs: 30, status: 200 });
        recordHttpEvent({ host: "json.edhrec.com", durationMs: 12, status: 500 });
        recordHttpEvent({ host: "", durationMs: 1, status: null });
      },
    );

    expect(snapshot.httpHosts).toEqual(["json.edhrec.com"]);
    expect(formatServerTiming(snapshot)).toBe(
      `total;dur=${snapshot.wallMs.toFixed(1)}, sql;dur=18.3;desc="2 queries", http;dur=43.0;desc="3 requests"`,
    );

    const zeroHttpTiming = formatServerTiming({
      kind: "mcp",
      label: "mcp:tools/list",
      at: "2026-11-27T08:00:00.000Z",
      client: null,
      startedAtMs: 0,
      wallMs: 42.1,
      otherMs: 40.6,
      sqlCount: 1,
      sqlMs: 1.5,
      sqlMaxMs: 1.5,
      txCount: 0,
      slowestSql: "SELECT 1",
      repeatedSql: null,
      repeatedSqlCount: 0,
      httpCount: 0,
      httpMs: 0,
      httpHosts: [],
    });
    expect(zeroHttpTiming).toBe('total;dur=42.1, sql;dur=1.5;desc="1 query", http;dur=0.0');
  });

  it("caps recentMetricEntries at 100 entries with newest first", async () => {
    for (let index = 0; index < 105; index += 1) {
      await runWithMetrics(
        { kind: "tool", label: `tool:item-${index}`, log: false },
        async () => {},
      );
    }

    const recent = recentMetricEntries();
    expect(recent).toHaveLength(100);
    expect(recent[0]?.label).toBe("tool:item-104");
    expect(recent[99]?.label).toBe("tool:item-5");
  });

  it("logs perf JSON for mcp/tool or high-sql actions and respects setMetricsLogging", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await runWithMetrics({ kind: "tool", label: "tool:logged" }, async () => {});
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]?.[0]).toBe("perf");
    expect(JSON.parse(String(infoSpy.mock.calls[0]?.[1]))).toMatchObject({
      kind: "tool",
      label: "tool:logged",
    });

    infoSpy.mockClear();
    await runWithMetrics({ kind: "action", label: "action:fast" }, async () => {
      recordQueryEvent({ durationMs: 1, sql: "SELECT 1", isTransactionControl: false });
    });
    expect(infoSpy).not.toHaveBeenCalled();

    await runWithMetrics({ kind: "action", label: "action:many-sql" }, async () => {
      for (let index = 0; index < 15; index += 1) {
        recordQueryEvent({ durationMs: 0.5, sql: "SELECT 1", isTransactionControl: false });
      }
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);

    infoSpy.mockClear();
    setMetricsLogging(false);
    await runWithMetrics({ kind: "mcp", label: "mcp:quiet" }, async () => {});
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("records failing operations and wraps action runners cleanly", async () => {
    setMetricsLogging(false);
    const runner = wrapObservedAction("action:save", async (value: number) => {
      recordQueryEvent({
        durationMs: 2,
        sql: "UPDATE decks SET name = $1",
        isTransactionControl: false,
      });
      if (value < 0) throw new Error("boom");
      return value * 2;
    });

    expect(await runner(3)).toBe(6);
    expect(recentMetricEntries()[0]).toMatchObject({
      kind: "action",
      label: "action:save",
      sqlCount: 1,
    });

    await expect(runner(-1)).rejects.toThrow("boom");
    expect(recentMetricEntries()[0]).toMatchObject({
      kind: "action",
      label: "action:save",
      sqlCount: 1,
    });

    expect(resolveActionLabel("action", "namedHandler", z.object({ a: z.string() }))).toBe(
      "action:namedHandler",
    );
    expect(resolveActionLabel("formAction", "", z.object({ deckId: z.number() }))).toContain(
      "formAction:",
    );
  });

  it("instruments pool.query and reused PoolClient.query without double-counting", async () => {
    const fakeClient = {
      query: vi.fn((config: unknown, valuesOrCb?: unknown, maybeCb?: unknown) => {
        const callback =
          typeof valuesOrCb === "function"
            ? valuesOrCb
            : typeof maybeCb === "function"
              ? maybeCb
              : undefined;
        const sqlText =
          typeof config === "string"
            ? config
            : typeof config === "object" && config !== null && "text" in config
              ? String((config as { text: unknown }).text)
              : "";
        if (sqlText.includes("FAIL")) {
          const error = new Error("query failed");
          if (callback) {
            (callback as (err: Error) => void)(error);
            return undefined;
          }
          return Promise.reject(error);
        }
        const queryResult = { rows: [{ ok: true }], rowCount: 1 };
        if (callback) {
          (callback as (err: undefined, result: typeof queryResult) => void)(
            undefined,
            queryResult,
          );
          return undefined;
        }
        return Promise.resolve(queryResult);
      }),
      release: vi.fn(),
    };

    vi.spyOn(Pool.prototype, "connect").mockImplementation(((
      callback?: (
        err: Error | undefined,
        client: PoolClient | undefined,
        done: (release?: unknown) => void,
      ) => void,
    ) => {
      const poolClient = fakeClient as unknown as PoolClient;
      if (callback) {
        callback(undefined, poolClient, () => undefined);
        return undefined;
      }
      return Promise.resolve(poolClient);
    }) as Pool["connect"]);

    // Mimic pg-pool's internal pool.query -> this.connect(cb) -> client.query(...) delegation.
    vi.spyOn(Pool.prototype, "query").mockImplementation(function (
      this: Pool,
      text: unknown,
      values?: unknown,
      callback?: unknown,
    ) {
      const actualCallback = typeof values === "function" ? values : callback;
      const actualValues = typeof values === "function" ? undefined : values;
      let resolvePromise!: (value: unknown) => void;
      let rejectPromise!: (reason?: unknown) => void;
      const promise =
        typeof actualCallback === "function"
          ? undefined
          : new Promise((resolve, reject) => {
              resolvePromise = resolve;
              rejectPromise = reject;
            });

      this.connect((err, client) => {
        if (err || !client) {
          const failure = err ?? new Error("Missing client");
          if (typeof actualCallback === "function") {
            (actualCallback as (error: Error) => void)(failure);
          } else {
            rejectPromise(failure);
          }
          return;
        }
        client.query(text as string, actualValues as unknown[], (queryErr, queryResult) => {
          if (typeof actualCallback === "function") {
            (actualCallback as (error: unknown, result: unknown) => void)(queryErr, queryResult);
          } else if (queryErr) {
            rejectPromise(queryErr);
          } else {
            resolvePromise(queryResult);
          }
        });
      });

      return promise as unknown as Promise<never>;
    });

    vi.spyOn(Pool.prototype, "end").mockResolvedValue(undefined);

    const events: QueryTimingEvent[] = [];
    const { db, close } = createDatabase("postgres://tcg@localhost/tcg", {
      onQuery: (event) => events.push(event),
    });
    const pool = (db as unknown as { $client: Pool }).$client;

    expect(pool.options.max).toBe(20);
    expect(pool.options.connectionTimeoutMillis).toBe(10_000);
    expect(pool.options.idleTimeoutMillis).toBe(30_000);
    expect(pool.options.statement_timeout).toBe(30_000);

    // Promise form via pool.query (must record once, even though pg-pool delegates to client.query).
    const firstResult = await pool.query("SELECT 1");
    expect(firstResult).toEqual({ rows: [{ ok: true }], rowCount: 1 });

    // Callback form via pool.query.
    const callbackResult = await new Promise((resolve, reject) => {
      pool.query({ text: "SELECT 2" }, (err, queryResult) => {
        if (err) reject(err);
        else resolve(queryResult);
      });
    });
    expect(callbackResult).toEqual({ rows: [{ ok: true }], rowCount: 1 });

    // Error propagation via pool.query.
    await expect(pool.query("SELECT FAIL")).rejects.toThrow("query failed");

    // Reused PoolClient via pool.connect() twice must not double-wrap client.query.
    const clientFirst = await pool.connect();
    await clientFirst.query("BEGIN");
    await clientFirst.query({ text: "SELECT 3" });
    await clientFirst.query("COMMIT");

    const clientSecond = await pool.connect();
    expect(clientSecond).toBe(clientFirst);
    await new Promise<void>((resolve, reject) => {
      clientSecond.query("ROLLBACK", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Subsequent pool.query using the already-wrapped client must STILL record once, not twice.
    await pool.query("SELECT 4");

    expect(events.map((event) => [event.sql, event.isTransactionControl])).toEqual([
      ["SELECT 1", false],
      ["SELECT 2", false],
      ["SELECT FAIL", false],
      ["BEGIN", true],
      ["SELECT 3", false],
      ["COMMIT", true],
      ["ROLLBACK", true],
      ["SELECT 4", false],
    ]);

    await close();
    await close();
  });
});
