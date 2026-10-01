#!/usr/bin/env bash
# Build the image here, copy it to the Docker server, and create or update the Portainer stack
# (docs/deploy.md). The image is tagged with the git commit, so every deploy can be rolled back.
#
#   scripts/deploy.sh
#
# Needs your server's settings in deploy/local.env (copy deploy/local.env.example; it's
# git-ignored), SSH access to the server (to load the image, which isn't in a registry) and a
# Portainer access token in ~/.config/proxy-library/portainer-token (Portainer → My account →
# Access tokens).
#
# The first deploy creates the stack with new random secrets, sent straight to Portainer (never
# printed or saved here). Later deploys keep the stack's settings and only change IMAGE_TAG.
set -euo pipefail
cd "$(dirname "$0")/.."

# Your server's settings: from the environment, else deploy/local.env.
if [[ -r deploy/local.env ]]; then
  set -a
  # shellcheck source=/dev/null
  source deploy/local.env
  set +a
fi
if [[ -z "${DEPLOY_HOST:-}" || -z "${DEPLOY_APP_URL:-}" ]]; then
  echo "Set DEPLOY_HOST and DEPLOY_APP_URL in deploy/local.env (see deploy/local.env.example)." >&2
  exit 1
fi
HOST="$DEPLOY_HOST"
PORTAINER_URL="${PORTAINER_URL:-https://$HOST:9443}"
TOKEN_FILE="${PORTAINER_TOKEN_FILE:-$HOME/.config/proxy-library/portainer-token}"
STACK_NAME="${STACK_NAME:-proxylib-stack}"
PORT="${DEPLOY_PORT:-3470}" # used only when the stack is first created
# Used only when the stack is first created. Afterwards, change them in Portainer.
APP_URL="$DEPLOY_APP_URL"
TZ_NAME="${DEPLOY_TZ:-UTC}"

if [[ ! -r "$TOKEN_FILE" ]]; then
  echo "No Portainer access token at $TOKEN_FILE (see docs/deploy.md)." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Commit your changes first: the image is tagged with the commit it was built from." >&2
  exit 1
fi
TAG="$(git rev-parse --short HEAD)"
IMAGE="proxy-library:$TAG"

# Portainer's API. The token goes in a header read from a file descriptor, so it never shows up
# in a process list. -k: Portainer uses a self-signed certificate on the home network.
portainer() {
  local method="$1" path="$2"
  shift 2
  curl --fail-with-body -sS -k -X "$method" \
    --header @<(printf 'X-API-Key: %s\n' "$(cat "$TOKEN_FILE")") \
    --header "Content-Type: application/json" "$@" "$PORTAINER_URL/api$path"
}

random_hex() {
  python3 -c 'import secrets, sys; print(secrets.token_hex(int(sys.argv[1])))' "$1"
}

echo "==> Building $IMAGE"
docker build --tag "$IMAGE" --tag proxy-library:latest .

echo "==> Copying the image to $HOST (compressed)"
docker save "$IMAGE" | gzip -1 | ssh "$HOST" 'gunzip | docker load'

ENDPOINT_ID="$(portainer GET /endpoints | jq -r '(map(select(.Name == "local")) + .)[0].Id')"
STACK_ID="$(portainer GET /stacks | jq -r --arg name "$STACK_NAME" '.[] | select(.Name == $name) | .Id')"

if [[ -z "$STACK_ID" ]]; then
  echo "==> Creating the Portainer stack $STACK_NAME, with new random secrets"
  # The secrets reach jq through its environment, not its command line.
  AUTH_SECRET="$(random_hex 32)" POSTGRES_PASSWORD="$(random_hex 24)" \
    jq -n --arg name "$STACK_NAME" --rawfile file deploy/stack.yml \
    --arg appUrl "$APP_URL" --arg port "$PORT" --arg tz "$TZ_NAME" --arg tag "$TAG" '{
      name: $name,
      stackFileContent: $file,
      env: [
        { name: "AUTH_SECRET", value: env.AUTH_SECRET },
        { name: "POSTGRES_PASSWORD", value: env.POSTGRES_PASSWORD },
        { name: "APP_URL", value: $appUrl },
        { name: "PORT", value: $port },
        { name: "SYNC_TIME", value: "04:00" },
        { name: "TZ", value: $tz },
        { name: "IMAGE_TAG", value: $tag }
      ]
    }' | portainer POST "/stacks/create/standalone/string?endpointId=$ENDPOINT_ID" --data @- >/dev/null
else
  echo "==> Updating the Portainer stack $STACK_NAME (id $STACK_ID) to $TAG"
  # Keep every setting already in Portainer; only the image tag changes.
  portainer GET "/stacks/$STACK_ID" |
    jq --rawfile file deploy/stack.yml --arg tag "$TAG" '{
      stackFileContent: $file,
      env: ([.Env[] | select(.name != "IMAGE_TAG")] + [{ name: "IMAGE_TAG", value: $tag }]),
      prune: true,
      pullImage: false
    }' | portainer PUT "/stacks/$STACK_ID?endpointId=$ENDPOINT_ID" --data @- >/dev/null
fi

# Portainer replaces the containers after the API call returns, and until then the old version
# still answers. So wait until the app container runs the new image and is healthy.
echo "==> Waiting for $IMAGE to be running and healthy"
APP_CONTAINER="$STACK_NAME-app-1"
for _ in $(seq 1 90); do
  STATE="$(ssh "$HOST" "docker inspect --format '{{.Config.Image}} {{.State.Health.Status}}' '$APP_CONTAINER'" 2>/dev/null || true)"
  if [[ "$STATE" == "$IMAGE healthy" ]]; then
    echo "Deployed $IMAGE. Open $APP_URL"
    exit 0
  fi
  sleep 2
done
echo "$IMAGE wasn't running and healthy within 3 minutes (last seen: ${STATE:-nothing})." >&2
echo "Check the stack in Portainer: its containers and their logs." >&2
exit 1
