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

| Service   | Does                                                                                         |
| --------- | -------------------------------------------------------------------------------------------- |
| `db`      | Postgres 17, data in the `pgdata` volume                                                     |
| `migrate` | brings the database schema up to date, then exits (the app and worker wait for it)           |
| `app`     | the web app on `http://localhost:${PORT}` (3000 by default)                                  |
| `worker`  | the nightly catalog sync, syncs admins queue from **Admin → Catalog**, and draft pick timers |

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

Live drafts keep a long-lived HTTP response open per player (Server-Sent Events, ADR 0018). The
app sends `X-Accel-Buffering: no`, which nginx (and Nginx Proxy Manager) honor, so nothing needs
configuring there. If a proxy buffers the stream anyway, the draft page notices and falls back to
reloading every 5 seconds, which works but feels less live.

## Deploying to a Portainer server

`scripts/deploy.sh` deploys to a Docker server managed by Portainer, as the stack
**proxylib-stack**. Your server's details live in **`deploy/local.env`**, which git ignores:
copy [`deploy/local.env.example`](../deploy/local.env.example) and fill in the server
(`DEPLOY_HOST`), the public address (`DEPLOY_APP_URL`), the port and the time zone. Below,
`your-server` and `https://proxylib.example.com` stand for your values.

| Piece      | Where                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack file | [`deploy/stack.yml`](../deploy/stack.yml): `docker-compose.yml` without the build step (Portainer stacks can't build)                       |
| App port   | `DEPLOY_PORT` on the server (3470 in the example; pick one that's free)                                                                     |
| HTTPS      | a reverse proxy (e.g. Nginx Proxy Manager): your domain → `http://your-server:3470`, a Let's Encrypt certificate, HTTPS only, websockets on |
| Settings   | the stack's **environment variables** in Portainer (`APP_URL`, `AUTH_SECRET`, `POSTGRES_PASSWORD`, `PORT`, `SYNC_TIME`, `TZ`, `IMAGE_TAG`)  |
| Data       | Docker volumes `proxylib-stack_pgdata` (the database), `…_images`, `…_sync-cache`, `…_backups`                                              |

### Deploying

From this repo, after committing (and running the tests):

```sh
scripts/deploy.sh
```

It builds the image here, tags it with the commit (`proxy-library:<commit>`), copies it to the
server over SSH (the image isn't in a registry), and creates or updates the stack through
Portainer's API. Migrations run before the new version starts. It needs a Portainer access token
(**Portainer → My account → Access tokens**) saved in `~/.config/proxy-library/portainer-token`
on this machine (`chmod 600`; never in the repo).

The **first** deploy creates the stack with new random `AUTH_SECRET` and `POSTGRES_PASSWORD`
values, sent straight to Portainer. Later deploys keep every setting and only change
`IMAGE_TAG`.

**Right after the first deploy, register your account**: on a new database, the first account
becomes the admin, and anyone who can reach the site could otherwise take that role.

**Roll back**: in Portainer, open the stack, set `IMAGE_TAG` to an earlier commit
(`docker images proxy-library` on the server lists them), and update the stack. Old images stay
on the server until something prunes them, so pruning limits how far back you can go.

**Change a setting** (for example `SYNC_TIME`): edit the environment variable in Portainer and
update the stack. Don't change `AUTH_SECRET` (it signs everyone out) or `POSTGRES_PASSWORD`
(the database keeps the password it was created with).

The containers opt out of **Watchtower** (if your server runs it), which would try to pull the
app's image from a registry.

### Official product photos (WPN)

The sync reads each enabled set's Wizards Play Network page (one a second) and downloads the
product photos and key art (about 35 MB for 20 sets, in the `images` volume). The first time
takes about 8 minutes; later syncs only read new or recent sets and fetch new images. Anything
without a photo shows generated art. Check and correct matches on **Admin → Photos**.

### Signing in: use the domain

When `APP_URL` is an `https://` address, sign-in cookies are marked HTTPS-only: sign in through
the domain, not `http://your-server:3470` (by design).

### Backups

If your server runs **Ofelia** (a job scheduler for Docker), it reads the backup job from labels on the `db` container (when Ofelia
starts, so restart it after changing them): every night at 10:30 UTC (change the schedule in `deploy/stack.yml` to suit your time zone), a
compressed dump (`pg_dump -Fc`) goes into the `backups` volume, and dumps older than 14
days are deleted. The volume is on the server's own disk, so copy a backup elsewhere now and then:

```sh
ssh your-server 'docker run --rm -v proxylib-stack_backups:/backups alpine ls -l /backups'
ssh your-server 'docker run --rm -v proxylib-stack_backups:/backups alpine cat /backups/proxy-library-2026-10-01.dump' > proxy-library-2026-10-01.dump
```

**Restore** a dump (this replaces the current database):

```sh
ssh your-server 'docker exec proxylib-stack-db-1 pg_restore -U tcg -d tcg --clean --if-exists /backups/proxy-library-2026-10-01.dump'
```
