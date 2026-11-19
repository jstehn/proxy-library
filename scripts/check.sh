#!/usr/bin/env bash
# `pnpm check`: everything that must pass before a commit (ADR 0023).
# The eight checks don't depend on each other, so they run at the same time. Each one's output is
# kept in a file and printed only if that check fails, so a green run prints one line per check.
# ESLint and Prettier keep a cache in node_modules/.cache: files that haven't changed since they
# last passed are skipped. `rm -rf node_modules/.cache` forces a full run.
set -uo pipefail
cd "$(dirname "$0")/.."

output_dir=$(mktemp -d)
trap 'rm -rf "$output_dir"' EXIT

names=(typecheck lint cycles format tests sizes clones knip)
commands=(
  "pnpm --silent typecheck"
  "pnpm --silent lint"
  "pnpm --silent lint:cycles"
  "pnpm --silent format:check"
  "pnpm exec vitest run --project unit"
  "pnpm --silent sizes"
  "pnpm --silent clones"
  # A report, not a gate yet (P24 makes it one): always succeeds and prints the finding count.
  "pnpm --silent knip:production 2>&1 | awk '/\\([0-9]+\\)\$/ { gsub(/[^0-9]/, \"\", \$NF); total += \$NF } END { print total + 0 \" findings\" }'"
)

process_ids=()
for index in "${!names[@]}"; do
  bash -c "${commands[$index]}" >"$output_dir/${names[$index]}" 2>&1 &
  process_ids+=($!)
done

failed=0
for index in "${!names[@]}"; do
  if wait "${process_ids[$index]}"; then
    if [ "${names[$index]}" = knip ]; then
      echo "✓ knip (report): $(cat "$output_dir/knip") (not a gate yet)"
    else
      echo "✓ ${names[$index]}"
    fi
  else
    echo "✗ ${names[$index]} (${commands[$index]})"
    cat "$output_dir/${names[$index]}"
    failed=1
  fi
done
exit $failed
