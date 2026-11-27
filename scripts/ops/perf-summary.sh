#!/usr/bin/env bash
# Summarize the app's `perf` log lines from the server's journal, per operation: how often it ran,
# and its median and worst wall time, queries, "other" time and most repeated statement.
#
#   scripts/ops/perf-summary.sh            # the last 3 days
#   scripts/ops/perf-summary.sh "1 day ago"
#
# Reads only. The containers log to journald, which keeps history across restarts and deploys.
# Needs DEPLOY_HOST in deploy/local.env (see docs/deploy.md) and `jq` here.
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck disable=SC1091
source deploy/local.env
SINCE="${1:-3 days ago}"
CONTAINER="proxylib-stack-app-1"

ssh -o BatchMode=yes "$DEPLOY_HOST" \
  "journalctl CONTAINER_NAME=$CONTAINER --since '$SINCE' --no-pager -o cat | grep '^perf '" |
  sed 's/^perf //' |
  jq -rs '
    def median: sort | .[(length / 2 | floor)];
    group_by(.label)
    | map({
        label: .[0].label,
        runs: length,
        medianMs: (map(.wallMs) | median),
        worstMs: (map(.wallMs) | max),
        medianQueries: (map(.sqlCount) | median),
        worstQueries: (map(.sqlCount) | max),
        medianOtherMs: (map(.otherMs // 0) | median),
        repeated: (map(select(.repeatedSqlCount > 0)) | sort_by(-.repeatedSqlCount) | .[0]
                   | if . == null then "" else "\(.repeatedSqlCount)x \(.repeatedSql)" end)
      })
    | sort_by(-(.runs * .medianMs))
    | (["OPERATION","RUNS","MEDIAN_MS","WORST_MS","MED_SQL","MAX_SQL","MED_OTHER_MS","MOST_REPEATED_STATEMENT"] | @tsv),
      (.[] | [.label, .runs, .medianMs, .worstMs, .medianQueries, .worstQueries, .medianOtherMs, .repeated] | @tsv)
  ' | column -t -s $'\t'
