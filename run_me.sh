#!/usr/bin/env bash
set -euo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${IMAGE:-spootyfy-hardened:local}"
CONTAINER="${CONTAINER:-jarri-spooty}"
PORT="${PORT:-3000}"
TOKEN="${SPOOTY_AUTH_TOKEN:-test-token}"
DOWNLOADS="${DOWNLOADS:-$PROJECT/test-downloads}"
CONFIG_DIR="${CONFIG_DIR:-$PROJECT/spooty-config}"
ENV_FILE="${ENV_FILE:-/etc/tokens/spotify.env}"
YT_COOKIES_FILE_HOST="${YT_COOKIES_FILE_HOST:-/etc/tokens/youtube.cookies.txt}"
YT_COOKIES_FILE_CONTAINER="${YT_COOKIES_FILE_CONTAINER:-/spooty/config/youtube.cookies.txt}"

cd "$PROJECT"

DOCKER="docker"
if ! docker ps >/dev/null 2>&1; then
  DOCKER="sudo docker"
fi

echo "== Docker before =="
$DOCKER ps --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' || true

if [[ "${1:-}" == "--build" ]]; then
  echo "== Building app =="
  npm run build
  $DOCKER build -t "$IMAGE" .
fi

echo "== Removing named container if present =="
$DOCKER rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo "== Removing any container bound to host port ${PORT} =="
PORT_CONTAINERS="$($DOCKER ps --filter "publish=${PORT}" -q || true)"
if [[ -n "$PORT_CONTAINERS" ]]; then
  $DOCKER rm -f $PORT_CONTAINERS
fi

mkdir -p "$DOWNLOADS" "$CONFIG_DIR"

echo "== Starting Jarri Spooty =="
$DOCKER run -d \
  --name "$CONTAINER" \
  -p "$PORT:3000" \
  --env-file "$ENV_FILE" \
  -e SPOTIFY_REDIRECT_URI="http://127.0.0.1:${PORT}/api/spotify/callback" \
  -e AUTH_ENABLED=true \
  -e SPOOTY_AUTH_TOKEN="$TOKEN" \
  -e YT_SEARCH_DELAY_MS=7000 \
  -e YT_DOWNLOADS_PER_MINUTE=6 \
  -e YT_DOWNLOAD_FALLBACK_ATTEMPTS=3 \
  -e YT_COOKIES_FILE="$YT_COOKIES_FILE_CONTAINER" \
  -v "$DOWNLOADS:/spooty/backend/downloads" \
  -v "$YT_COOKIES_FILE_HOST:$YT_COOKIES_FILE_CONTAINER:ro" \
  -v "$CONFIG_DIR:/spooty/backend/config" \
  "$IMAGE"

echo
echo "== Docker after =="
$DOCKER ps --filter "name=^/${CONTAINER}$" --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'

echo
echo "Open:"
echo "http://127.0.0.1:${PORT}/?token=${TOKEN}"
echo
echo "Logs:"
echo "$DOCKER logs -f $CONTAINER"
