import { AsyncLocalStorage } from "node:async_hooks";
import type { QueryTimingEvent } from "@/shared/db";

export type MetricKind = "mcp" | "tool" | "action" | "page";

export type MetricEntry = Readonly<{
  kind: MetricKind;
  label: string;
  /** Who called: the MCP client's name or the HTTP User-Agent (null for pages and actions). */
  client: string | null;
  /** When the operation started, as an ISO timestamp (to match a slow call to what happened then). */
  at: string;
  startedAtMs: number;
  wallMs: number;
  /**
   * Wall time spent neither waiting on the database nor on outbound HTTP: JavaScript, rendering,
   * or waiting for a free connection. Overlapping queries count once, so this never goes negative.
   */
  otherMs: number;
  sqlCount: number;
  sqlMs: number;
  sqlMaxMs: number;
  txCount: number;
  slowestSql: string | null;
  /** The statement shape that ran most often (values stripped), when it ran at least twice. */
  repeatedSql: string | null;
  repeatedSqlCount: number;
  httpCount: number;
  httpMs: number;
  httpHosts: readonly string[];
}>;

export type MetricStore = {
  kind: MetricKind;
  label: string;
  at: string;
  client: string | null;
  startedAtMs: number;
  waitMs: number;
  lastWaitEndMs: number;
  statementCounts: Map<string, number>;
  sqlCount: number;
  sqlMs: number;
  sqlMaxMs: number;
  txCount: number;
  slowestSql: string | null;
  slowestWasTx: boolean;
  httpCount: number;
  httpMs: number;
  httpHosts: Set<string>;
};

const MAX_RECENT_ENTRIES = 100;
const SLOW_WALL_MS = 250;
const HIGH_SQL_COUNT = 15;
const MAX_SQL_LENGTH = 160;
const MAX_CLIENT_LENGTH = 80;
const REPEATED_SQL_COUNT = 5;
const MAX_DISTINCT_STATEMENTS = 200;

const metricsStorage = new AsyncLocalStorage<MetricStore>();
let fallbackStoreLookup: (() => MetricStore | undefined) | null = null;
const recentEntries: MetricEntry[] = [];
let loggingEnabled = true;

function activeStore(): MetricStore | undefined {
  return metricsStorage.getStore() ?? fallbackStoreLookup?.();
}

/**
 * Register a fallback lookup for the active metric store when `AsyncLocalStorage` has none
 * (used by `page-metrics.ts` with React `cache()`, since `enterWith()` inside an async helper
 * does not survive back to the caller after `await`).
 */
export function registerFallbackMetricStore(lookup: (() => MetricStore | undefined) | null): void {
  fallbackStoreLookup = lookup;
}

/** Whether a metric measurement is already active in this request or async operation. */
export function hasActiveMetrics(): boolean {
  return activeStore() !== undefined;
}

function roundMs(durationMs: number): number {
  return Math.round(durationMs * 10) / 10;
}

function compactSql(sqlText: string, maxLength: number = MAX_SQL_LENGTH): string {
  return sqlText.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/** The statement with its values stripped, so the same query with different ids counts as one. */
function statementShape(sqlText: string): string {
  return compactSql(sqlText, Number.POSITIVE_INFINITY)
    .replace(/'[^']*'/g, "?")
    .replace(/\$\d+/g, "?")
    .replace(/\b\d+\b/g, "?")
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, "(?, …)");
}

function countStatement(store: MetricStore, sqlText: string): void {
  const shape = statementShape(sqlText);
  const known = store.statementCounts.get(shape);
  if (known !== undefined) {
    store.statementCounts.set(shape, known + 1);
  } else if (store.statementCounts.size < MAX_DISTINCT_STATEMENTS) {
    store.statementCounts.set(shape, 1);
  }
}

function mostRepeatedStatement(store: MetricStore): { sql: string | null; count: number } {
  let sql: string | null = null;
  let count = 1;
  for (const [shape, shapeCount] of store.statementCounts) {
    if (shapeCount > count) {
      sql = shape;
      count = shapeCount;
    }
  }
  return sql === null ? { sql: null, count: 0 } : { sql: sql.slice(0, MAX_SQL_LENGTH), count };
}

/**
 * Add a finished wait (a query or an HTTP call) to the time spent waiting. Waits arrive in the
 * order they end, so counting only the part after the previous wait's end adds overlapping
 * (parallel) waits once.
 */
function addWait(store: MetricStore, durationMs: number): void {
  const endMs = performance.now();
  const startMs = Math.max(endMs - durationMs, store.lastWaitEndMs, store.startedAtMs);
  if (endMs > startMs) store.waitMs += endMs - startMs;
  store.lastWaitEndMs = Math.max(store.lastWaitEndMs, endMs);
}

function finalizeSnapshot(store: MetricStore): MetricEntry {
  const wallMs = performance.now() - store.startedAtMs;
  const repeated = mostRepeatedStatement(store);
  return {
    kind: store.kind,
    label: store.label,
    at: store.at,
    client: store.client,
    startedAtMs: roundMs(store.startedAtMs),
    wallMs: roundMs(wallMs),
    otherMs: roundMs(Math.max(0, wallMs - store.waitMs)),
    sqlCount: store.sqlCount,
    sqlMs: roundMs(store.sqlMs),
    sqlMaxMs: roundMs(store.sqlMaxMs),
    txCount: store.txCount,
    slowestSql: store.slowestSql,
    repeatedSql: repeated.sql,
    repeatedSqlCount: repeated.count,
    httpCount: store.httpCount,
    httpMs: roundMs(store.httpMs),
    httpHosts: [...store.httpHosts],
  };
}

function pushRecentEntry(entry: MetricEntry): void {
  recentEntries.unshift(entry);
  if (recentEntries.length > MAX_RECENT_ENTRIES) {
    recentEntries.pop();
  }
}

/** Enable or disable console perf logging globally (composition roots disable it in test mode). */
export function setMetricsLogging(enabled: boolean): void {
  loggingEnabled = enabled;
}

/** Record a database query timing into the active async operation, if one exists. */
export function recordQueryEvent(event: QueryTimingEvent): void {
  const store = activeStore();
  if (store === undefined) return;
  store.sqlCount += 1;
  store.sqlMs += event.durationMs;
  addWait(store, event.durationMs);
  if (event.isTransactionControl) {
    store.txCount += 1;
  } else {
    countStatement(store, event.sql);
  }
  if (
    store.slowestSql === null ||
    event.durationMs > store.sqlMaxMs ||
    (store.slowestWasTx && !event.isTransactionControl && event.durationMs >= store.sqlMaxMs)
  ) {
    store.sqlMaxMs = event.durationMs;
    store.slowestSql = compactSql(event.sql);
    store.slowestWasTx = event.isTransactionControl;
  }
}

/** Record an outbound HTTP call timing into the active async operation, if one exists. */
export function recordHttpEvent(event: {
  host: string;
  durationMs: number;
  status: number | null;
}): void {
  const store = activeStore();
  if (store === undefined) return;
  store.httpCount += 1;
  store.httpMs += event.durationMs;
  addWait(store, event.durationMs);
  if (event.host.length > 0) {
    store.httpHosts.add(event.host);
  }
}

/** Update the current operation's label (for example after parsing an MCP JSON-RPC body). */
export function setMetricLabel(label: string): void {
  const store = activeStore();
  if (store !== undefined) {
    store.label = label;
  }
}

function createStore(kind: MetricKind, label: string): MetricStore {
  const startedAtMs = performance.now();
  return {
    kind,
    label,
    at: new Date(performance.timeOrigin + startedAtMs).toISOString(),
    client: null,
    startedAtMs,
    waitMs: 0,
    lastWaitEndMs: startedAtMs,
    statementCounts: new Map<string, number>(),
    sqlCount: 0,
    sqlMs: 0,
    sqlMaxMs: 0,
    txCount: 0,
    slowestSql: null,
    slowestWasTx: false,
    httpCount: 0,
    httpMs: 0,
    httpHosts: new Set<string>(),
  };
}

/** Record a finished operation in the recent list and print it when it is worth a log line. */
function finishStore(store: MetricStore, snapshot: MetricEntry | undefined, log: boolean) {
  const entry = snapshot ?? finalizeSnapshot(store);
  pushRecentEntry(entry);
  const shouldLog =
    log &&
    loggingEnabled &&
    (entry.kind === "mcp" ||
      entry.kind === "tool" ||
      entry.wallMs >= SLOW_WALL_MS ||
      entry.sqlCount >= HIGH_SQL_COUNT ||
      entry.repeatedSqlCount >= REPEATED_SQL_COUNT);
  if (shouldLog) {
    console.info("perf", JSON.stringify(entry));
  }
  return entry;
}

/** Note who is calling (an MCP client's name or a User-Agent), so unexpected traffic can be traced. */
export function setMetricClient(client: string): void {
  const store = activeStore();
  if (store !== undefined && client.length > 0) {
    store.client = client.slice(0, MAX_CLIENT_LENGTH);
  }
}

/** Run an async operation under an isolated AsyncLocalStorage metrics context. */
export async function runWithMetrics<T>(
  input: { kind: MetricKind; label: string; log?: boolean },
  work: () => Promise<T>,
): Promise<{ result: T; snapshot: MetricEntry }> {
  const store = createStore(input.kind, input.label);
  let snapshot: MetricEntry | undefined;
  try {
    const result = await metricsStorage.run(store, work);
    snapshot = finalizeSnapshot(store);
    return { result, snapshot };
  } finally {
    finishStore(store, snapshot, input.log ?? true);
  }
}

/**
 * Open a metric store without entering `AsyncLocalStorage`, for callers that hold the store in
 * their own per-request container (such as React `cache()` for page renders).
 */
export function openMetricStore(input: { kind: MetricKind; label: string }): Readonly<{
  store: MetricStore;
  setLabel: (label: string) => void;
  finish: () => MetricEntry;
}> {
  const store = createStore(input.kind, input.label);
  let finished = false;
  return {
    store,
    setLabel(label: string) {
      store.label = label;
    },
    finish() {
      if (finished) return finalizeSnapshot(store);
      finished = true;
      return finishStore(store, undefined, true);
    },
  };
}

/** Format a finalized metrics snapshot into an HTTP `Server-Timing` header value. */
export function formatServerTiming(snapshot: MetricEntry): string {
  const queryWord = snapshot.sqlCount === 1 ? "query" : "queries";
  const httpMetric =
    snapshot.httpCount > 0
      ? `http;dur=${snapshot.httpMs.toFixed(1)};desc="${snapshot.httpCount} ${snapshot.httpCount === 1 ? "request" : "requests"}"`
      : `http;dur=${snapshot.httpMs.toFixed(1)}`;
  return [
    `total;dur=${snapshot.wallMs.toFixed(1)}`,
    `sql;dur=${snapshot.sqlMs.toFixed(1)};desc="${snapshot.sqlCount} ${queryWord}"`,
    httpMetric,
  ].join(", ");
}

/** Return up to the last 100 recorded metric entries, newest first. */
export function recentMetricEntries(): readonly MetricEntry[] {
  return [...recentEntries];
}

function extractCallerLocation(stack: string | undefined): string | null {
  if (!stack) return null;
  for (const line of stack.split("\n")) {
    if (
      line.includes("observability.ts") ||
      line.includes("action-instance.ts") ||
      line.includes("form-action-instance.ts")
    ) {
      continue;
    }
    const match = /(?:src\/app\/|src\/)([^\s):]+:\d+)/.exec(line);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return null;
}

function extractSchemaKeys(schema: unknown): string | null {
  if (typeof schema === "object" && schema !== null && "shape" in schema) {
    const shape = (schema as { shape?: unknown }).shape;
    if (typeof shape === "object" && shape !== null) {
      const keys = Object.keys(shape).slice(0, 4);
      if (keys.length > 0) return keys.join(",");
    }
  }
  return null;
}

/** Build a concise label for a server action from handler name, call site, or schema fields. */
export function resolveActionLabel(prefix: string, handlerName: string, schema: unknown): string {
  if (handlerName.length > 0 && handlerName !== "handler") {
    return `${prefix}:${handlerName}`;
  }
  const location = extractCallerLocation(new Error().stack);
  if (location !== null) {
    return `${prefix}:${location}`;
  }
  const keys = extractSchemaKeys(schema);
  return keys !== null ? `${prefix}:${keys}` : prefix;
}

/** Wrap a server-action runner so every invocation runs inside `runWithMetrics`. */
export function wrapObservedAction<Args extends readonly unknown[], Return>(
  label: string,
  runner: (...args: Args) => Promise<Return>,
): (...args: Args) => Promise<Return> {
  return async (...args: Args) => {
    const { result } = await runWithMetrics({ kind: "action", label }, () => runner(...args));
    return result;
  };
}
