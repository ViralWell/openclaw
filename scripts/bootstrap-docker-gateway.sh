#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: scripts/bootstrap-docker-gateway.sh --public-host <host> [--bind <mode>] [--force]

Initializes Docker Compose gateway config for non-interactive deployments.
Runs idempotently and preserves existing Control UI allowedOrigins unless --force is set.
EOF
  exit 2
}

PUBLIC_HOST=""
BIND_MODE="lan"
FORCE_CONFIG=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --public-host)
      shift
      [[ $# -gt 0 ]] || usage
      PUBLIC_HOST="$1"
      ;;
    --bind)
      shift
      [[ $# -gt 0 ]] || usage
      BIND_MODE="$1"
      ;;
    --force)
      FORCE_CONFIG=1
      ;;
    *)
      usage
      ;;
  esac
  shift
done

[[ -n "$PUBLIC_HOST" ]] || usage

current_mode="$(
  docker compose run --rm openclaw-cli config get gateway.mode 2>/dev/null || true
)"
current_mode="${current_mode//$'\r'/}"
if [[ "$FORCE_CONFIG" -eq 1 || -z "$current_mode" || "$current_mode" == "null" ]]; then
  docker compose run --rm openclaw-cli config set gateway.mode local >/dev/null
fi

current_bind="$(
  docker compose run --rm openclaw-cli config get gateway.bind 2>/dev/null || true
)"
current_bind="${current_bind//$'\r'/}"
if [[ "$FORCE_CONFIG" -eq 1 || -z "$current_bind" || "$current_bind" == "null" ]]; then
  docker compose run --rm openclaw-cli config set gateway.bind "$BIND_MODE" >/dev/null
fi

if [[ "$BIND_MODE" != "loopback" ]]; then
  current_allowed_origins="$(
    docker compose run --rm openclaw-cli config get gateway.controlUi.allowedOrigins 2>/dev/null || true
  )"
  current_allowed_origins="${current_allowed_origins//$'\r'/}"
  if [[ "$FORCE_CONFIG" -eq 1 || -z "$current_allowed_origins" || "$current_allowed_origins" == "null" || "$current_allowed_origins" == "[]" ]]; then
    allowed_origin_json="$(printf '["http://%s","https://%s"]' "$PUBLIC_HOST" "$PUBLIC_HOST")"
    docker compose run --rm openclaw-cli \
      config set gateway.controlUi.allowedOrigins "$allowed_origin_json" --strict-json >/dev/null
  fi
fi
