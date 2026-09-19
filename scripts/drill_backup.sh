#!/bin/bash
# Ensaio de backup e restauração (FASE 14): cria 100 registros de teste, faz backup, apaga, restaura e confere.
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL}"
PSQL="psql $DATABASE_URL -q -t -A"
echo "1) registros antes: $($PSQL -c 'SELECT count(*) FROM employees')"
$PSQL -c "INSERT INTO employees (nome, unit_id, vinculo, admissao, situacao) SELECT 'Ensaio Backup '||g, (SELECT min(id) FROM units), 'CLT', CURRENT_DATE, 'ATIVO' FROM generate_series(1,100) g"
ANTES=$($PSQL -c "SELECT count(*) FROM employees WHERE nome LIKE 'Ensaio Backup %'"); SOMA=$($PSQL -c "SELECT md5(string_agg(nome, ',' ORDER BY nome)) FROM employees WHERE nome LIKE 'Ensaio Backup %'")
echo "2) inseridos: $ANTES · checksum $SOMA"
TMP=$(mktemp -d); DATABASE_URL="$DATABASE_URL" bash "$(dirname "$0")/backup.sh" "$TMP" >/dev/null; ARQ=$(ls -1t "$TMP"/*.dump | head -1); echo "3) backup: $ARQ"
$PSQL -c "DELETE FROM employees WHERE nome LIKE 'Ensaio Backup %'"; echo "4) apagados: restam $($PSQL -c "SELECT count(*) FROM employees WHERE nome LIKE 'Ensaio Backup %'")"
T0=$(date +%s); DATABASE_URL="$DATABASE_URL" bash "$(dirname "$0")/restore.sh" "$ARQ" >/dev/null 2>&1 || true; T1=$(date +%s)
DEPOIS=$($PSQL -c "SELECT count(*) FROM employees WHERE nome LIKE 'Ensaio Backup %'"); SOMA2=$($PSQL -c "SELECT md5(string_agg(nome, ',' ORDER BY nome)) FROM employees WHERE nome LIKE 'Ensaio Backup %'")
echo "5) restaurados: $DEPOIS · checksum $SOMA2 · tempo $((T1-T0))s"
$PSQL -c "DELETE FROM employees WHERE nome LIKE 'Ensaio Backup %'"
if [ "$ANTES" = "$DEPOIS" ] && [ "$SOMA" = "$SOMA2" ]; then echo "RESULTADO: OK — backup e restauração íntegros ($ANTES registros, checksum igual)"; else echo "RESULTADO: FALHA"; exit 1; fi
