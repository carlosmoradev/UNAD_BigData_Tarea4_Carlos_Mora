#!/usr/bin/env bash
# Run one query script (or all, in order) against the container.
# Usage: ./run.sh [01_indexes.js | 02_crud.js | ...]
# COMPACT=1 prints one document per line instead of pretty-printed JSON
# (same queries, only the output format changes; useful for screenshots).
set -euo pipefail
CONTAINER="${CONTAINER:-tarea4-mongo}"
DIR="$(cd "$(dirname "$0")" && pwd)"
COMPACT_SHOW='const show = (title, value) => { const v = value \&\& value.toArray ? value.toArray() : value; print("\\n== " + title); const fmt = d => "  " + require("util").inspect(d, { breakLength: 150, depth: 8 }).split("\\n").join("\\n  "); if (Array.isArray(v)) v.forEach(d => print(fmt(d))); else print(fmt(v)); };'
files=("$@")
[ ${#files[@]} -eq 0 ] && files=("$DIR"/0[1-9]_*.js)
for f in "${files[@]}"; do
  [ -f "$f" ] || f="$DIR/$f"
  echo "######## $(basename "$f")"
  if [ "${COMPACT:-0}" = "1" ]; then
    sed "s|^const show = .*|${COMPACT_SHOW}|" "$f"
  else
    cat "$f"
  fi | docker exec -i "$CONTAINER" mongosh --quiet platform_observability --file /dev/stdin
done
