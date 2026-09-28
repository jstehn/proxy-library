#!/usr/bin/env bash
# Everything needed to use the app locally, in one command (`pnpm dev:all`):
# the database, any new migrations, the web app, and the worker (nightly sync + "Sync now").
# Ctrl+C stops the web app and the worker. Postgres keeps running (`pnpm db:stop` stops it).
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/db.sh start
pnpm --silent db:migrate

# When this script exits (Ctrl+C or the web app stopping), stop everything it started.
# `kill 0` signals the whole process group: the worker and the web app.
trap 'trap - EXIT INT TERM; kill 0 2>/dev/null; wait' EXIT INT TERM

# The worker in the background, each of its lines labelled so they stand out from the app's.
pnpm --silent worker schedule 2>&1 | sed -u 's/^/[worker] /' &

pnpm --silent dev
