#!/usr/bin/env sh
# Compressed PostgreSQL backup with 7-day retention.
set -eu
: "${DATABASE_URL:?DATABASE_URL must be set}"
OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
pg_dump "$DATABASE_URL" | gzip > "$OUT_DIR/app_db-$STAMP.sql.gz"
find "$OUT_DIR" -name 'app_db-*.sql.gz' -mtime +"${RETENTION_DAYS:-7}" -delete
echo "backup written to $OUT_DIR/app_db-$STAMP.sql.gz"
