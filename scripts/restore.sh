#!/bin/bash
# Restauração para um banco VAZIO (de homologação ou o de produção após incidente). Uso: DATABASE_URL=postgres://... ./scripts/restore.sh arquivo.dump
set -euo pipefail
ARQ="${1:?informe o arquivo .dump}"
[ -f "$ARQ.sha256" ] && sha256sum -c "$ARQ.sha256"
pg_restore --no-owner --no-privileges --clean --if-exists --dbname="${DATABASE_URL:?defina DATABASE_URL}" "$ARQ"
echo "restauração concluída de $ARQ"
