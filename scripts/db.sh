#!/usr/bin/env bash
# Manage the project-local Postgres instance (data + socket in ./.dev).
# Usage: scripts/db.sh start|stop|status|reset
set -euo pipefail

: "${PGDATA:?PGDATA not set - is direnv loaded? (run: direnv allow)}"
: "${PGHOST:?PGHOST not set}"

init() {
  if [[ ! -f "$PGDATA/PG_VERSION" ]]; then
    echo "Initialising database cluster in $PGDATA"
    mkdir -p "$PGDATA"
    initdb --username="$PGUSER" --auth=trust --encoding=UTF8 >/dev/null
  fi
}

start() {
  init
  if pg_ctl status >/dev/null 2>&1; then
    echo "Postgres already running"
  else
    # -k: socket directory; listen_addresses='': no TCP port, socket only
    pg_ctl start -l "$PGHOST/postgres.log" -o "-k $PGHOST -c listen_addresses=''" -w >/dev/null
    echo "Postgres started (socket in $PGHOST)"
  fi
  ensure_database "$PGDATABASE"
  ensure_database "${PGDATABASE}_test" # used by integration tests (see docs/architecture/testing.md)
  ensure_database "${PGDATABASE}_e2e"  # used by end-to-end (browser) tests
}

ensure_database() {
  if ! psql -d postgres -tAc "select 1 from pg_database where datname = '$1'" | grep -q 1; then
    createdb "$1"
    echo "Created database $1"
  fi
}

stop() {
  if pg_ctl status >/dev/null 2>&1; then
    pg_ctl stop -m fast >/dev/null
    echo "Postgres stopped"
  else
    echo "Postgres not running"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) pg_ctl status || true ;;
  reset) stop; rm -rf "$PGDATA"; start ;;
  *) echo "usage: $0 start|stop|status|reset" >&2; exit 1 ;;
esac
