# 0018. Live updates: Postgres LISTEN/NOTIFY and Server-Sent Events

- **Status:** Accepted (design doc 17)
- **Date:** 2026-10-01

## Context

Until now every page showed what was true when it loaded. A live draft (design doc 17) needs
several browsers to see a change **as soon as it happens**: a pick, a player joining, the server
auto-picking for someone. The changes are made by server actions in the app **and** by the worker
(the pick timer), which is a separate process. The app runs as one container (Docker Compose,
design doc 11) behind whatever proxy the playgroup uses.

## Decision

- **The database announces changes.** A use case that changes a draft calls
  `DraftNotifier.changed(draftId, version)`. Its adapter runs `pg_notify` on the `drafts` channel
  with `"<id>:<version>"`, **inside the transaction**. Postgres delivers a notification only when
  its transaction commits, so browsers never hear about a change that was rolled back, and the
  worker's changes reach the app with no extra plumbing.
- **The app listens once.** One dedicated `pg` client runs `LISTEN drafts` (built lazily in the
  app's container, reconnecting if the connection drops) and hands each notification to in-memory
  subscribers for that draft.
- **Browsers subscribe with Server-Sent Events.** `GET /api/drafts/[id]/events` is a route handler
  that returns a `text/event-stream` `ReadableStream`. It sends the current version on connect,
  every new version, and a comment every 15 seconds (to keep proxies from closing it and to record
  presence). It unsubscribes when `request.signal` aborts.
- **The message is only "something changed".** The browser then reloads the page's server data
  (`router.refresh()`), so what a player can see is decided by the same query as a page load.
  The stream never carries cards.
- **Writes stay server actions.** Picks don't go over the stream.

## Consequences

- No new service (no Redis, no WebSocket server), and nothing changes in the Docker setup.
- One extra database connection in the app, held open.
- A browser that misses an event (a proxy dropping the stream) recovers on reconnect, since the
  first message is always the current version. `EventSource` reconnects by itself. The page also
  falls back to polling if it can't stream.
- Notifications are per process: with **several app containers** each would `LISTEN` on its own,
  which works unchanged. That's a property of NOTIFY we get for free.
- NOTIFY payloads are limited to 8000 bytes and aren't stored. We send ids, never data.

## Alternatives considered

- **Polling every few seconds:** simplest, but slow to feel live and a query per player per tick.
  Kept only as the fallback.
- **WebSockets:** two-way, but Next.js route handlers can't upgrade a connection without a custom
  server, and we only need one direction.
- **An in-memory event bus in the app:** misses the worker's auto-picks, and breaks with more
  than one app process.
- **Redis pub/sub:** a new service to run for something Postgres already does.
