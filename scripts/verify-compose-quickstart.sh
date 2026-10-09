#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_name="time-friend-quickstart-verify-$$"

export WEB_PORT="${WEB_PORT:-33000}"
export API_PORT="${API_PORT:-34000}"
export POSTGRES_PORT="${POSTGRES_PORT:-35433}"
export POSTGRES_DB="time_friend"
export POSTGRES_USER="time_friend"
export POSTGRES_PASSWORD="time_friend"
export NEXT_PUBLIC_API_URL="http://localhost:${API_PORT}"
export BETTER_AUTH_URL="http://localhost:${API_PORT}"
export WEB_ORIGINS="http://localhost:${WEB_PORT}"
export BETTER_AUTH_SECRET="time-friend-quickstart-verification-secret"
export TRAJECTORY_PROVIDER="openai"
export TRAJECTORY_MODEL="gpt-5-mini"
export OPENAI_API_KEY=""
export DEEPSEEK_API_KEY=""
export OTEL_EXPORTER_OTLP_ENDPOINT=""
export SENTRY_DSN=""

compose() {
  docker compose --project-directory "$repo_root" -p "$project_name" "$@"
}

cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

assert_http_ok() {
  local url="$1"
  curl --fail --silent --show-error "$url" >/dev/null
}

assert_probe() {
  local value
  value="$(compose exec -T postgres psql -U time_friend -d time_friend -Atc \
    "select value from public.quickstart_persistence_probe where id = 1")"
  if [[ "$value" != "survived" ]]; then
    echo "persistence probe mismatch: expected survived, got ${value:-<empty>}" >&2
    return 1
  fi
}

echo "[1/6] Build and start an isolated quickstart stack"
compose up -d --build --wait

echo "[2/6] Verify web, API liveness, API readiness, and migration history"
assert_http_ok "http://127.0.0.1:${WEB_PORT}"
assert_http_ok "http://127.0.0.1:${API_PORT}/health"
assert_http_ok "http://127.0.0.1:${API_PORT}/ready"
migration_count="$(compose exec -T postgres psql -U time_friend -d time_friend -Atc \
  "select count(*) from drizzle.__drizzle_migrations")"
if [[ "$migration_count" -lt 1 ]]; then
  echo "expected at least one applied migration" >&2
  exit 1
fi

echo "[3/6] Write a persistence probe"
compose exec -T postgres psql -U time_friend -d time_friend -v ON_ERROR_STOP=1 <<'SQL'
create table public.quickstart_persistence_probe (
  id integer primary key,
  value text not null
);
insert into public.quickstart_persistence_probe (id, value) values (1, 'survived');
SQL

echo "[4/6] Restart every long-running service and verify health and data"
compose restart postgres api worker web
compose up -d --wait
assert_http_ok "http://127.0.0.1:${WEB_PORT}"
assert_http_ok "http://127.0.0.1:${API_PORT}/ready"
assert_probe

echo "[5/6] Remove containers without deleting the volume, then recreate the stack"
compose down
compose up -d --wait
assert_http_ok "http://127.0.0.1:${WEB_PORT}"
assert_http_ok "http://127.0.0.1:${API_PORT}/ready"
assert_probe
migration_count_after_recreate="$(compose exec -T postgres psql -U time_friend -d time_friend -Atc \
  "select count(*) from drizzle.__drizzle_migrations")"
if [[ "$migration_count_after_recreate" != "$migration_count" ]]; then
  echo "migration history changed after an idempotent rerun: ${migration_count} -> ${migration_count_after_recreate}" >&2
  exit 1
fi

echo "[6/6] Quickstart verification passed (${migration_count} migrations recorded)"
