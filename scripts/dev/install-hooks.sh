#!/usr/bin/env bash
# `pnpm hooks:install`: writes a pre-commit hook for this checkout (works in a worktree too).
# The hook is the fast part of `pnpm check`: Prettier on the staged files, then the typecheck and
# the lint. No unit tests, so a commit stays under about 30 seconds. Skip it once with
# `git commit --no-verify`.
set -euo pipefail
cd "$(dirname "$0")/../.."

hook_path="$(git rev-parse --git-path hooks)/pre-commit"
mkdir -p "$(dirname "$hook_path")"

cat >"$hook_path" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

staged=$(git diff --cached --name-only --diff-filter=ACMR)
if [ -n "$staged" ]; then
  # shellcheck disable=SC2086
  echo "$staged" | xargs pnpm exec prettier --check --ignore-unknown
fi
pnpm --silent typecheck
pnpm --silent lint
HOOK

chmod 755 "$hook_path"
echo "Installed the pre-commit hook at $hook_path"
