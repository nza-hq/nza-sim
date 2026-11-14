#!/usr/bin/env bash
# Recreates database "t" on a local Postgres 16 (PGHOST/PGPORT, default /tmp:54329) with the Supabase stand-in and every
# migration in supabase/migrations/, in order. Test data only; never point this at a Supabase project.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
P="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-54329} -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists t" -c "create database t" postgres
$P -f "$HERE/standin.sql" t
for f in "$REPO"/supabase/migrations/*.sql; do $P -f "$f" t; done
