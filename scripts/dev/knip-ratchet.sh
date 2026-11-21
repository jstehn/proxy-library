#!/usr/bin/env bash
# The knip gate (P24): `knip --production` findings must not exceed docs/refactor/knip-baseline.txt.
# `scripts/dev/knip-ratchet.sh --update` lowers the baseline to today's count (it never raises it).
set -uo pipefail
cd "$(dirname "$0")/../.."

baseline_file=docs/refactor/knip-baseline.txt
count=$(pnpm --silent knip:production 2>&1 |
  awk '/\([0-9]+\)$/ { gsub(/[^0-9]/, "", $NF); total += $NF } END { print total + 0 }')
baseline=$(cat "$baseline_file")

if [ "${1:-}" = "--update" ]; then
  if [ "$count" -lt "$baseline" ]; then
    echo "$count" >"$baseline_file"
    echo "knip baseline lowered from $baseline to $count"
  else
    echo "knip baseline stays at $baseline (today: $count)"
  fi
  exit 0
fi

if [ "$count" -gt "$baseline" ]; then
  echo "$count findings, baseline $baseline: run 'pnpm knip:production' and remove the new ones"
  exit 1
fi
echo "$count findings (baseline $baseline)"
