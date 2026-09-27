# Design: Activity, export & Docker

- **Phase:** 11
- **Status:** **Approved** (self-approved during the unattended run, 2026-09-27; see
  [decisions-to-review.md](../decisions-to-review.md))
- **Related ADRs:** 0004 (ledgers), 0005 (unit of work), 0010 (Nix for development; Docker later)

## 1. Purpose & scope

The last phase makes the app something a playgroup can run and live with:

1. **Activity feed:** everyone sees notable pulls, sealed purchases and completed trades (decided
   before the run), on the home page and at `/activity`. Money amounts other than card prices stay
   private.
2. **Collection export:** Moxfield CSV, a plain text list, and a full CSV (decided before the run).
3. **Docker:** one image for the app and the worker, and a Compose file with Postgres, the app,
   the worker and volumes, **built and run locally to prove it works** (decided before the run).
4. **Polish from use:** a collapsible menu on phones, an opt-in `pnpm test:remote` suite, and a
   `check-products` worker command (every product for sale must contain something, the rule from
   the empty-precon bug).

**Out of scope:** public player profiles, e-mail notifications, hosting and TLS (the Compose file
serves plain HTTP on a port; put it behind your own reverse proxy).

## 2. Activity events

```ts
type ActivityEvent =
  | {
      kind: "pull";
      actorId;
      itemName: string;
      cards: { printingId; name; finish; rarity; priceCents }[];
    }
  | { kind: "purchase"; actorId; productName: string; quantity: number } // no price: money stays private
  | {
      kind: "trade";
      actorId /* the one who accepted */;
      otherId;
      cardsMoved: number;
      moneyChanged: boolean;
    };
```

- **Recorded inside the same transaction** as the thing it describes (patterns.md 16,
  "transactional outbox-lite"): if the opening rolls back, so does its event.
- The activity module offers `recordEvent(services, event)` and an `ActivityServices` port. The
  inventory, store and trades modules call it, like `spend` or `receiveCards`.
- **A notable pull** is the opener's "hit": rare or better, or worth $5 or more. One event per
  pack, listing its notable cards. Packs with none record nothing.
- `activity_events(id, kind, actor_id, occurred_at, payload jsonb)`, with an index on
  `occurred_at desc`.
- Feed: the newest 50 at `/activity`, the newest 5 on the home page, with names and card links.

## 3. Export

Pure exporters in the collection module, one shape (`(rows) → string`), in a strategy table:

| Format     | Contents                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `moxfield` | Moxfield's collection CSV: `Count, Tradelist Count, Name, Edition, Condition, Language, Foil, Tags, Last Modified, Collector Number, Alter, Proxy, Purchase Price` |
| `text`     | `4 Lightning Bolt (M11) 149`, with ` *F*` or ` *E*` for foil and etched                                                                                            |
| `full`     | set, number, name, finish, rarity, quantity, market price, total value, first and last acquired                                                                    |

CSV fields are quoted by one tested `csvField` function (quotes doubled, fields containing commas,
quotes or line breaks wrapped). The route `/api/export/collection?format=…` answers with a file
download (`Content-Disposition: attachment`).

## 4. Docker

- **One image** (`Dockerfile`, multi-stage): install dependencies, build Next.js with
  `output: "standalone"`, then a slim runtime stage holding the standalone server plus what the
  worker needs (`worker/`, `src/`, `drizzle/`, `tsx`).
- **`docker-compose.yml`:** `db` (postgres:17, with a volume and a health check); `migrate` (runs
  once: `pnpm worker migrate`); `app` (the web server on port 3000, after `migrate` succeeds); and
  `worker` (`pnpm worker schedule`). Volumes: `pgdata`, `images`, `sync-cache`.
- **Configuration** comes only from environment variables, as since Phase 0. `.env.example`
  documents them, and `AUTH_SECRET` must be set.
- **Backups:** `scripts/backup.sh` runs `pg_dump` inside the `db` container into `backups/`.
- **Tested locally:** build, start, `/api/health` answers, the register page renders, and the
  worker's `health` command passes. A full catalog sync isn't run in the test, because it downloads
  about 80 MB from Scryfall. The README says how to run the first one.

## 5. Polish

- **Phone menu:** on narrow screens the main menu folds into a "Menu" button (`<details>`, so no
  JavaScript is needed). The wallet balance stays visible.
- **`pnpm test:remote`:** a Vitest project for `*.remote.test.ts`, never part of `test`, `check`
  or `test:int`. Two tiny checks: MTGJSON's `Meta.json` and Scryfall's bulk-data listing still
  parse with our schemas.
- **`pnpm worker check-products`:** unpacks every product for sale in enabled sets, to its leaves,
  and reports any that give nothing, or refer to a pack, deck or product the catalog doesn't have.

## 6. Test plan

- **Unit:** event construction (notable pulls), exporters and CSV quoting (commas, quotes,
  "Name // Other Name"), the product check on sample products.
- **Integration:** opening a pack records a pull event only when there's a hit, and a rolled-back
  purchase records nothing; the feed query.
- **End-to-end:** the home page shows recent activity, and the export downloads a file.
- **Docker:** the local build and run described in section 4.

## 7. Decisions made without review

1. **Purchases in the feed show the product, not the price**: "money amounts other than card
   prices stay private".
2. **Trades in the feed show who traded and how many cards**, not what or for how much.
3. **The app container runs migrations through a separate one-shot service**, so a failed
   migration stops the app from starting instead of running half-migrated.
4. **Condition "Near Mint", language "English"** in the Moxfield export, since the app tracks
   neither.

## 8. Implementation notes (what changed while building)

- **The image keeps the full install and uses `next start`**, not the standalone output. The
  worker runs TypeScript with `tsx` and needs `src/`, `worker/`, `drizzle/` and every dependency
  anyway, so one full image is simpler. It's larger (hundreds of MB), which is fine for a home server.
- **Files in the image belong to the `node` user** (`COPY --chown`). The first run failed with
  "Permission denied": one repository file was only readable by its owner on the host.
- **The worker stops on `SIGTERM`** as well as `SIGINT`, so `docker compose stop` ends it cleanly.
- **The Docker test did more than planned:** a fresh install's worker starts the first sync right
  away (it has never synced), and it finished (35 sets, about 80 MB from Scryfall) in about 40
  seconds, before it was stopped. That's exactly what a real first deployment does, so it proved
  the worker too. docs/deploy.md tells new users to expect it.
- **`check-products` found real problems** before any screens were built on it: TMT's "Enemy
  Deck" (no cards yet), HOB's Co-op Kit (only extras, and it **was for sale**), and the stale empty
  Reality Fracture precon rows. Fixes: empty deck lists are left out; products missing from a
  set's latest import are **unlisted** (kept for owned items, never sold); references ignore
  unlisted rows and the importing set's own old rows. All 451 products for sale then passed.
- **A pg deprecation warning** ("client.query() when the client is already executing a query")
  came from `Promise.all` on a transaction's single connection in `knownReferences`. It's now one
  query at a time.
