#!/usr/bin/env bash
# Backs up the Docker deployment's database to backups/tcg-<date>.sql.gz (design doc 11).
# Restore: gunzip -c backups/tcg-….sql.gz | docker compose exec -T db psql -U tcg -d tcg
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
file="backups/tcg-$(date +%Y-%m-%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U tcg -d tcg --no-owner | gzip > "$file"
echo "wrote $file"
