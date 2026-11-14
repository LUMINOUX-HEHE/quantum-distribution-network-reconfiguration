#!/usr/bin/env sh
# Restore a compressed dump. Verify with /api/health afterwards.
set -eu
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${1:?usage: restore.sh <backup.sql.gz>}"
gunzip -c "$1" | psql "$DATABASE_URL"
echo "restore complete; check /api/health and re-run the regression suite"
