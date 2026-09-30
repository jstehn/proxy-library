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

## Our Docker server (Portainer, proxylib.example.com)

Proxy Library runs on the Docker server at `your-server` as the Portainer stack
**proxylib-stack**, and players open it at **https://proxylib.example.com**.

| Piece      | Where                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack file | [`deploy/stack.yml`](../deploy/stack.yml): `docker-compose.yml` without the build step (Portainer stacks can't build)                                |
| App port   | **3470** on the server (3000 was taken)                                                                                                          |
| HTTPS      | Nginx Proxy Manager: proxy host `proxylib.example.com` → `http://your-server:3470`, Let's Encrypt certificate, Force SSL, websockets on |
| Settings   | the stack's **environment variables** in Portainer (`APP_URL`, `AUTH_SECRET`, `POSTGRES_PASSWORD`, `PORT`, `SYNC_TIME`, `TZ`, `IMAGE_TAG`)           |
| Data       | Docker volumes `proxylib-stack_pgdata` (the database), `…_images`, `…_sync-cache`, `…_backups`                                                       |

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
(`docker images proxy-library` on the server lists them), and update the stack. The server's
weekly prune deletes unused images older than 7 days, so that's how far back you can go.

**Change a setting** (for example `SYNC_TIME`): edit the environment variable in Portainer and
update the stack. Don't change `AUTH_SECRET` (it signs everyone out) or `POSTGRES_PASSWORD`
(the database keeps the password it was created with).

The containers opt out of **Watchtower**, which would try to pull the app's image from a registry.

### Signing in: use the domain

`APP_URL` is `https://proxylib.example.com`, so sign-in cookies are marked
HTTPS-only: sign in through the domain, not `http://your-server:3470` (by design).

### Backups

The server's **Ofelia** reads the backup job from labels on the `db` container: every night at
03:30, a compressed dump (`pg_dump -Fc`) goes into the `backups` volume, and dumps older than 14
days are deleted. The volume is on the server's own disk, so copy a backup elsewhere now and then:

```sh
ssh your-server 'docker run --rm -v proxylib-stack_backups:/backups alpine ls -l /backups'
ssh your-server 'docker run --rm -v proxylib-stack_backups:/backups alpine cat /backups/proxy-library-2026-10-01.dump' > proxy-library-2026-10-01.dump
```

**Restore** a dump (this replaces the current database):

```sh
ssh your-server 'docker exec proxylib-stack-db-1 pg_restore -U tcg -d tcg --clean --if-exists /backups/proxy-library-2026-10-01.dump'
```
