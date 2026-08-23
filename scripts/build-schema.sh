#!/usr/bin/env bash
# Concatenates prisma/_parts/*.prisma into prisma/schema.prisma
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=apps/api/prisma/schema.prisma
: > "$OUT"
for f in apps/api/prisma/_parts/*.prisma; do
  cat "$f" >> "$OUT"
  printf '\n' >> "$OUT"
done
echo "Built $OUT ($(wc -l < "$OUT") lines)"
