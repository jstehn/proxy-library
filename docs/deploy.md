# Running it for your playgroup (Docker)

Development uses Nix and direnv (see the [README](../README.md)). To run the app on a home server
for other people, use Docker Compose: one image runs both the web app and the worker, next to
Postgres.

## First start

```sh
cp .env.example .env
# Edit .env: set AUTH_SECRET (e.g. `openssl rand -hex 32`), APP_URL, POSTGRES_PASSWORD.
docker compose up -d --build
```

What starts (see `docker-compose.yml`):

| Service   | Does                                                                               |
| --------- | ---------------------------------------------------------------------------------- |
| `db`      | Postgres 17, data in the `pgdata` volume                                           |
| `migrate` | brings the database schema up to date, then exits (the app and worker wait for it) |
| `app`     | the web app on `http://localhost:${PORT}` (3000 by default)                        |
| `worker`  | the nightly catalog sync, plus syncs admins queue from **Admin → Catalog**         |

Open the app and **register**: the first account becomes the admin. The worker's **first sync
starts within a minute** of the first start, because a new install has never synced. It
downloads Scryfall's card data (about 80 MB) and MTGJSON's files for the current Standard sets
(and their Commander companion sets), which takes a minute or two. Watch it with
`docker compose logs -f worker`, or on **Admin → Catalog**.

## Every day

- **Nightly sync** at `SYNC_TIME` (default 04:00, in `TZ`): new prices, and new sets you enabled.
- **Card images** are fetched from Scryfall the first time someone views a card, then served from
  the `images` volume.
- **Updating the app:** `git pull && docker compose up -d --build`. Migrations run automatically
  before the new version starts.

## Backups

```sh
scripts/backup.sh                     # writes backups/tcg-<date>.sql.gz
gunzip -c backups/tcg-….sql.gz | docker compose exec -T db psql -U tcg -d tcg   # restore
```

Back up the `images` and `sync-cache` volumes too if you like. They can always be downloaded
again, so they aren't essential.

## Checks

```sh
docker compose exec worker pnpm worker health          # database reachable?
docker compose exec worker pnpm worker check-packs     # every booster recipe opens correctly
docker compose exec worker pnpm worker check-products  # every product for sale contains something
```

## Behind a reverse proxy

The app serves plain HTTP. For access from outside your network, put it behind a reverse proxy
with TLS (Caddy, nginx, Traefik), and set `APP_URL` to the public `https://` address, since invite
links and cookies use it.
