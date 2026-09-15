#!/usr/bin/env bash
# A local PostgreSQL for development — no installer, no service, no elevation.
#
#   bash scripts/pg-local.sh init     unpack, initdb, create the database
#   bash scripts/pg-local.sh start
#   bash scripts/pg-local.sh stop
#   bash scripts/pg-local.sh status
#   bash scripts/pg-local.sh psql     open a shell on the database
#
# Two deliberate choices:
#
#   Port 5433, not 5432, so this never collides with a PostgreSQL you install
#   properly later.
#
#   `-A trust` and listening only on 127.0.0.1. Trust means no password — which
#   is safe here *only* because nothing outside this machine can reach it, the
#   same reasoning the application's own bind guard uses. It also means there is
#   no credential to store, echo or leak. Do not copy this to anything hosted.
set -e
cd "$(dirname "$0")/.."

ZIP="${PG_ZIP:-C:/Users/$USERNAME/AppData/Local/Temp/claude/D--Files-Desktop-AI/6196f321-c9ae-42ca-919f-aba1b0fa751f/scratchpad/pg17.zip}"
ROOT="$(pwd)/.pgsql"          # unpacked binaries
DATA="$(pwd)/.pgdata"         # cluster
LOG="$(pwd)/.pgdata/server.log"
PORT="${PG_PORT:-5433}"
DB="${PG_DB:-dpwh_doc_control}"
USER_="${PG_USER:-postgres}"
BIN="$ROOT/pgsql/bin"

url() { echo "postgres://$USER_@127.0.0.1:$PORT/$DB"; }

case "${1:-status}" in
  init)
    if [ ! -d "$BIN" ]; then
      [ -f "$ZIP" ] || { echo "Binaries zip not found: $ZIP"; echo "Set PG_ZIP to its path."; exit 1; }
      echo "Unpacking PostgreSQL binaries…"
      mkdir -p "$ROOT"
      # -o overwrite, -q quiet; the zip contains a top-level pgsql/
      unzip -oq "$ZIP" -d "$ROOT"
    fi
    [ -d "$BIN" ] || { echo "Unpack did not produce $BIN"; exit 1; }

    if [ ! -f "$DATA/PG_VERSION" ]; then
      echo "Initialising cluster (trust auth, loopback only)…"
      mkdir -p "$DATA"
      "$BIN/initdb.exe" -D "$DATA" -U "$USER_" -A trust -E UTF8 >/dev/null
      # belt and braces: refuse anything that is not loopback
      printf '\nlisten_addresses = %s\nport = %s\n' "'127.0.0.1'" "$PORT" >> "$DATA/postgresql.conf"
    fi

    bash "$0" start
    if ! "$BIN/psql.exe" -h 127.0.0.1 -p "$PORT" -U "$USER_" -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$DB"; then
      echo "Creating database $DB…"
      "$BIN/createdb.exe" -h 127.0.0.1 -p "$PORT" -U "$USER_" "$DB"
    fi
    echo
    echo "Ready. Put this in .env:"
    echo "  DATABASE_URL=$(url)"
    ;;

  start)
    [ -d "$BIN" ] || { echo "Not initialised — run: bash scripts/pg-local.sh init"; exit 1; }
    if "$BIN/pg_isready.exe" -h 127.0.0.1 -p "$PORT" -q 2>/dev/null; then
      echo "Already running on 127.0.0.1:$PORT"
    else
      "$BIN/pg_ctl.exe" -D "$DATA" -l "$LOG" -o "-p $PORT -h 127.0.0.1" -w start
    fi
    ;;

  stop)
    [ -d "$BIN" ] && "$BIN/pg_ctl.exe" -D "$DATA" -m fast -w stop || echo "not initialised"
    ;;

  status)
    if [ -d "$BIN" ] && "$BIN/pg_isready.exe" -h 127.0.0.1 -p "$PORT" 2>/dev/null; then
      echo "DATABASE_URL=$(url)"
    else
      echo "not running"
    fi
    ;;

  psql)
    "$BIN/psql.exe" -h 127.0.0.1 -p "$PORT" -U "$USER_" -d "$DB"
    ;;

  url) url ;;

  *) echo "usage: $0 {init|start|stop|status|psql|url}"; exit 1 ;;
esac
