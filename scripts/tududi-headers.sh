#!/usr/bin/env bash
# The tududi MCP server's auth header (.mcp.json `headersHelper`). Claude Code runs this when it
# connects, which can be before direnv has loaded .envrc.local, so read the key from there
# directly. Prints a JSON object of headers on stdout, and nothing else.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${TUDUDI_API_KEY:-}" && -f "$root/.envrc.local" ]]; then
  # shellcheck source=/dev/null
  source "$root/.envrc.local" >/dev/null 2>&1
fi
if [[ -z "${TUDUDI_API_KEY:-}" ]]; then
  echo "TUDUDI_API_KEY is not set (see .envrc.local.example)" >&2
  exit 1
fi
key="${TUDUDI_API_KEY//\\/\\\\}"
key="${key//\"/\\\"}"
printf '{"Authorization": "Bearer %s"}\n' "$key"
