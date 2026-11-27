import { AsyncLocalStorage } from "node:async_hooks";
import type { QueryTimingEvent } from "@/shared/db";

export type MetricKind = "mcp" | "tool" | "action";

export type MetricEntry = Readonly<{
  kind: MetricKind;
  label: string;
  startedAtMs: number;
  wallMs: number;
  sqlCount: number;
  sqlMs: number;
  sqlMaxMs: number;
  txCount: number;
  slowestSql: string | null;
  httpCount: number;
  httpMs: number;
  httpHosts: readonly string[];
}>;

type MutableMetricStore = {
  kind: MetricKind;
  label: string;
  startedAtMs: number;
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

const metricsStorage = new AsyncLocalStorage<MutableMetricStore>();
const recentEntries: MetricEntry[] = [];
let loggingEnabled = true;

function roundMs(durationMs: number): number {
  return Math.round(durationMs * 10) / 10;
}

function compactSql(sqlText: string): string {
  return sqlText.replace(/\s+/g, " ").trim().slice(0, MAX_SQL_LENGTH);
}

function finalizeSnapshot(store: MutableMetricStore): MetricEntry {
  return {
    kind: store.kind,
    label: store.label,
    startedAtMs: roundMs(store.startedAtMs),
    wallMs: roundMs(performance.now() - store.startedAtMs),
    sqlCount: store.sqlCount,
    sqlMs: roundMs(store.sqlMs),
    sqlMaxMs: roundMs(store.sqlMaxMs),
    txCount: store.txCount,
    slowestSql: store.slowestSql,
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
  const store = metricsStorage.getStore();
  if (store === undefined) return;
  store.sqlCount += 1;
  store.sqlMs += event.durationMs;
  if (event.isTransactionControl) {
    store.txCount += 1;
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
  const store = metricsStorage.getStore();
  if (store === undefined) return;
  store.httpCount += 1;
  store.httpMs += event.durationMs;
  if (event.host.length > 0) {
    store.httpHosts.add(event.host);
  }
}

/** Update the current operation's label (for example after parsing an MCP JSON-RPC body). */
export function setMetricLabel(label: string): void {
  const store = metricsStorage.getStore();
  if (store !== undefined) {
    store.label = label;
  }
}

/** Run an async operation under an isolated AsyncLocalStorage metrics context. */
export async function runWithMetrics<T>(
  input: { kind: MetricKind; label: string; log?: boolean },
  work: () => Promise<T>,
): Promise<{ result: T; snapshot: MetricEntry }> {
  const store: MutableMetricStore = {
    kind: input.kind,
    label: input.label,
    startedAtMs: performance.now(),
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

  let snapshot: MetricEntry | undefined;
  try {
    const result = await metricsStorage.run(store, work);
    snapshot = finalizeSnapshot(store);
    return { result, snapshot };
  } finally {
    const entry = snapshot ?? finalizeSnapshot(store);
    pushRecentEntry(entry);
    const shouldLog =
      (input.log ?? true) &&
      loggingEnabled &&
      (entry.kind === "mcp" ||
        entry.kind === "tool" ||
        entry.wallMs >= SLOW_WALL_MS ||
        entry.sqlCount >= HIGH_SQL_COUNT);
    if (shouldLog) {
      console.info("perf", JSON.stringify(entry));
    }
  }
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
