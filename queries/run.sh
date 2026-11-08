#!/usr/bin/env bash
# Run one query script (or all, in order) against the container.
# Usage: ./run.sh [01_indexes.js | 02_crud.js | ...]
set -euo pipefail
CONTAINER="${CONTAINER:-tarea4-mongo}"
DIR="$(cd "$(dirname "$0")" && pwd)"
files=("$@")
[ ${#files[@]} -eq 0 ] && files=("$DIR"/0[1-9]_*.js)
for f in "${files[@]}"; do
  [ -f "$f" ] || f="$DIR/$f"
  echo "######## $(basename "$f")"
  docker exec -i "$CONTAINER" mongosh --quiet platform_observability --file /dev/stdin < "$f"
done
