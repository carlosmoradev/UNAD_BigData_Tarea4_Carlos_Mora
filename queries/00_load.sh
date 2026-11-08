#!/usr/bin/env bash
# Reload the seed data into the running container (drops existing collections).
set -euo pipefail
CONTAINER="${CONTAINER:-tarea4-mongo}"
DB=platform_observability
for c in services log_events incidents; do
  docker exec "$CONTAINER" mongoimport --quiet --db "$DB" --collection "$c" --drop --file "/seed/$c.jsonl"
done
echo "Loaded: services, log_events, incidents"
