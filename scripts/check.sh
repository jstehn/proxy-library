#!/usr/bin/env bash
# `pnpm check`: everything that must pass before a commit (ADR 0023).
# The five checks don't depend on each other, so they run at the same time. Each one's output is
# kept in a file and printed only if that check fails, so a green run prints one line per check.
# ESLint and Prettier keep a cache in node_modules/.cache: files that haven't changed since they
# last passed are skipped. `rm -rf node_modules/.cache` forces a full run.
set -uo pipefail
cd "$(dirname "$0")/.."

output_dir=$(mktemp -d)
trap 'rm -rf "$output_dir"' EXIT

names=(typecheck lint cycles format tests)
commands=(
  "pnpm --silent typecheck"
  "pnpm --silent lint"
  "pnpm --silent lint:cycles"
  "pnpm --silent format:check"
  "pnpm exec vitest run --project unit"
)

process_ids=()
for index in "${!names[@]}"; do
  bash -c "${commands[$index]}" >"$output_dir/${names[$index]}" 2>&1 &
  process_ids+=($!)
done

failed=0
for index in "${!names[@]}"; do
  if wait "${process_ids[$index]}"; then
    echo "✓ ${names[$index]}"
  else
    echo "✗ ${names[$index]} (${commands[$index]})"
    cat "$output_dir/${names[$index]}"
    failed=1
  fi
done
exit $failed
