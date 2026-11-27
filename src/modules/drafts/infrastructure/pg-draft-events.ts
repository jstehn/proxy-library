import { sql } from "drizzle-orm";
import { Client } from "pg";
import type { DbExecutor } from "@/shared/db";
import type { DraftNotifier } from "../application/ports";
import type { DraftId } from "../domain/draft";

// Live updates through Postgres (ADR 0018). The notifier speaks inside a transaction, so
// Postgres delivers the message only if that transaction commits. The listener holds one
// connection that hears every draft's messages and hands them to whoever subscribed.

const CHANNEL = "drafts";

export function pgDraftNotifier(db: DbExecutor): DraftNotifier {
  async function changed(draftId: DraftId, version: number): Promise<void> {
    await db.execute(sql`select pg_notify(${CHANNEL}, ${`${draftId}:${version}`})`);
  }
  return { changed };
}

/**
 * Called with a draft's new version, or with null after the connection was lost and came back,
 * when changes may have been missed (the browser should simply reload its view).
 */
export type DraftListener = (version: number | null) => void;

export type DraftSubscriptions = Readonly<{
  /** Starts listening for one draft's changes; call the returned function to stop. */
  subscribe(draftId: number, listener: DraftListener): () => void;
  close(): Promise<void>;
}>;

/** "12:7" → draft 12, version 7; anything else is ignored. */
function parseNotification(payload: string | undefined) {
  const match = /^(\d+):(\d+)$/.exec(payload ?? "");
  return match === null ? null : { draftId: Number(match[1]), version: Number(match[2]) };
}

export function pgDraftSubscriptions(databaseUrl: string): DraftSubscriptions {
  const listeners = new Map<number, Set<DraftListener>>();
  let client: Client | null = null;
  let connecting: Promise<boolean> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 1000;
  let closed = false;

  function tellEveryone(version: number | null) {
    for (const set of listeners.values()) for (const listener of set) listener(version);
  }

  function reconnectLater() {
    if (closed || listeners.size === 0 || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect().then((connected) => {
        if (connected) tellEveryone(null); // we may have missed changes meanwhile
      });
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30_000);
  }

  async function connect(): Promise<boolean> {
    if (closed) return false;
    if (client !== null) return true;
    connecting ??= (async () => {
      const fresh = new Client({ connectionString: databaseUrl, keepAlive: true });
      let handledDisconnect = false;
      function onDisconnect() {
        if (handledDisconnect) return;
        handledDisconnect = true;
        if (client === fresh) client = null;
        void fresh.end().catch(() => undefined);
        reconnectLater();
      }
      fresh.on("notification", (message) => {
        const parsed = parseNotification(message.payload);
        if (parsed === null) return;
        for (const listener of listeners.get(parsed.draftId) ?? []) listener(parsed.version);
      });
      fresh.on("error", onDisconnect);
      fresh.on("end", onDisconnect);
      try {
        await fresh.connect();
        await fresh.query(`listen ${CHANNEL}`);
        if (closed) {
          void fresh.end().catch(() => undefined);
          return false;
        }
        client = fresh;
        retryDelay = 1000;
        return true;
      } catch {
        onDisconnect();
        return false;
      } finally {
        connecting = null;
      }
    })();
    return connecting;
  }

  function subscribe(draftId: number, listener: DraftListener): () => void {
    const set = listeners.get(draftId) ?? new Set<DraftListener>();
    set.add(listener);
    listeners.set(draftId, set);
    void connect();
    return function unsubscribe() {
      set.delete(listener);
      if (set.size === 0) listeners.delete(draftId);
    };
  }

  async function close(): Promise<void> {
    closed = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    listeners.clear();
    const current = client;
    client = null;
    await current?.end();
  }

  return { subscribe, close };
}
