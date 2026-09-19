#!/bin/bash
# Backup lógico do banco (formato custom do PostgreSQL, comprimido). Uso: DATABASE_URL=postgres://... ./scripts/backup.sh [pasta]
set -euo pipefail
DEST="${1:-./backups}"; mkdir -p "$DEST"
ARQ="$DEST/status_one_$(date +%Y%m%d_%H%M%S).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$ARQ" "${DATABASE_URL:?defina DATABASE_URL}"
sha256sum "$ARQ" > "$ARQ.sha256"
echo "backup gravado: $ARQ ($(du -h "$ARQ" | cut -f1))"
# retenção: mantém os últimos 30 arquivos
ls -1t "$DEST"/status_one_*.dump 2>/dev/null | tail -n +31 | xargs -r rm -f
