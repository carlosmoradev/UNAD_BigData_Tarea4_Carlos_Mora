#!/usr/bin/env python3
"""Generate deterministic seed data for the `platform_observability` database.

Outputs three JSONL files (MongoDB Extended JSON, one document per line)
that can be loaded with `mongoimport`:

    data/services.jsonl   (12 documents)
    data/log_events.jsonl (170 documents)
    data/incidents.jsonl  (25 documents)

Usage:
    python3 generate_data.py [output_dir]
"""
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEED = 20261108
ANCHOR = datetime(2026, 10, 1, tzinfo=timezone.utc)
WINDOW_DAYS = 30
N_EVENTS = 170
N_INCIDENTS = 25

rng = random.Random(SEED)

# --------------------------------------------------------------------------
# Services
# --------------------------------------------------------------------------
SERVICES = [
    # id, team, tier, kind, region, dependencies
    ("payments-api", "payments", 1, "api", "us-east-1", ["auth-svc", "postgres-main"]),
    ("auth-svc", "identity", 1, "api", "us-east-1", ["postgres-main", "redis-cache"]),
    ("orders-api", "commerce", 1, "api", "us-east-1", ["payments-api", "inventory-svc"]),
    ("inventory-svc", "commerce", 2, "api", "us-west-2", ["postgres-main"]),
    ("notifications-worker", "engagement", 3, "worker", "us-east-1", ["queue-broker"]),
    ("billing-worker", "payments", 2, "worker", "us-east-1", ["queue-broker", "payments-api"]),
    ("report-generator", "data", 3, "worker", "eu-west-1", ["postgres-main"]),
    ("search-api", "discovery", 2, "api", "eu-west-1", ["redis-cache"]),
    ("gateway", "platform", 1, "api", "us-east-1", ["auth-svc", "orders-api"]),
    ("postgres-main", "platform", 1, "database", "us-east-1", []),
    ("redis-cache", "platform", 2, "database", "us-east-1", []),
    ("queue-broker", "platform", 2, "database", "us-east-1", []),
]

ONCALL = ["Ana Torres", "Luis Gómez", "Marta Ruiz", "Diego Peña", "Sofía Castro"]

# Heavier weight = more log traffic for that service
TRAFFIC = {
    "gateway": 5, "payments-api": 4, "orders-api": 4, "auth-svc": 3,
    "search-api": 3, "inventory-svc": 2, "billing-worker": 2,
    "notifications-worker": 2, "report-generator": 1, "postgres-main": 2,
    "redis-cache": 1, "queue-broker": 1,
}

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
_oid_counter = 0


def oid():
    """Deterministic ObjectId-like hex string, as Extended JSON."""
    global _oid_counter
    _oid_counter += 1
    return {"$oid": f"{0x65000000 + _oid_counter:08x}{rng.getrandbits(64):016x}"}


def date(dt):
    return {"$date": dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")}


def rand_ts():
    offset = rng.randint(0, WINDOW_DAYS * 24 * 3600 - 1)
    return ANCHOR + timedelta(seconds=offset)


def hex_id(n):
    return "".join(rng.choice("0123456789abcdef") for _ in range(n))


# --------------------------------------------------------------------------
# Log events
# --------------------------------------------------------------------------
LEVELS = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"]
LEVEL_WEIGHTS = [10, 40, 20, 25, 5]

API_MESSAGES = {
    "INFO": ["Request completed", "Health check ok", "Cache hit"],
    "DEBUG": ["Parsed request headers", "Resolved upstream route"],
    "WARN": ["Slow upstream response", "Retrying request", "Rate limit near threshold"],
    "ERROR": ["Timeout calling upstream", "Unhandled exception in handler", "Connection reset by peer"],
    "FATAL": ["Out of memory, restarting", "Cannot bind port"],
}
WORKER_MESSAGES = {
    "INFO": ["Job completed", "Batch processed"],
    "DEBUG": ["Job picked from queue", "Heartbeat sent"],
    "WARN": ["Job retry scheduled", "Queue depth above threshold"],
    "ERROR": ["Job failed after retries", "Deserialization error", "Downstream call timed out"],
    "FATAL": ["Worker crashed: unrecoverable state"],
}
DB_MESSAGES = {
    "INFO": ["Checkpoint complete", "Replica in sync"],
    "DEBUG": ["Vacuum started", "Connection pool stats"],
    "WARN": ["Slow query detected", "Replication lag rising"],
    "ERROR": ["Deadlock detected", "Max connections reached", "Disk usage above 90%"],
    "FATAL": ["Primary unreachable", "Data directory corrupted"],
}
MESSAGES = {"api": API_MESSAGES, "worker": WORKER_MESSAGES, "database": DB_MESSAGES}

TAGS_BY_LEVEL = {
    "DEBUG": ["debug"],
    "INFO": ["routine"],
    "WARN": ["degradation"],
    "ERROR": ["timeout", "upstream", "exception", "capacity"],
    "FATAL": ["crash", "outage"],
}


def make_event(service):
    sid, _team, _tier, kind, _region, _deps = service
    level = rng.choices(LEVELS, LEVEL_WEIGHTS)[0]
    message = rng.choice(MESSAGES[kind][level])
    failing = level in ("ERROR", "FATAL")

    doc = {
        "_id": oid(),
        "service_id": sid,
        "ts": date(rand_ts()),
        "level": level,
        "message": message,
        "tags": rng.sample(TAGS_BY_LEVEL[level], k=1) + (["slow"] if "Slow" in message else []),
    }

    # Variable structure per service kind: this is the point of using MongoDB.
    if kind == "api":
        status = rng.choice([500, 502, 503, 504]) if failing else rng.choice([200, 200, 200, 201, 204, 429])
        doc["latency_ms"] = rng.randint(1500, 5000) if failing else rng.randint(8, 900)
        doc["http"] = {
            "method": rng.choice(["GET", "POST", "PUT"]),
            "path": rng.choice(["/charge", "/orders", "/login", "/search", "/stock", "/health"]),
            "status": status,
        }
        doc["meta"] = {"trace_id": hex_id(16), "host": f"{sid}-{rng.randint(1, 4)}"}
    elif kind == "worker":
        doc["meta"] = {
            "queue": rng.choice(["emails", "invoices", "reports"]),
            "job_id": f"job-{rng.randint(10000, 99999)}",
            "attempt": rng.randint(3, 5) if failing else rng.randint(1, 2),
        }
        if rng.random() < 0.6:
            doc["latency_ms"] = rng.randint(200, 30000)
    else:  # database
        doc["meta"] = {
            "db_host": f"{sid}-{rng.choice(['primary', 'replica-1', 'replica-2'])}",
            "connections": rng.randint(180, 500) if failing else rng.randint(10, 150),
        }
        if rng.random() < 0.5:
            doc["query_ms"] = rng.randint(1200, 9000) if failing else rng.randint(1, 400)
    return doc


# --------------------------------------------------------------------------
# Build all collections
# --------------------------------------------------------------------------
def build():
    services = []
    for sid, team, tier, _kind, region, deps in SERVICES:
        services.append({
            "_id": sid,
            "team": team,
            "tier": tier,
            "env": "prod",
            "region": region,
            "owner": {"name": rng.choice(ONCALL), "oncall": f"oncall-{team}@example.com"},
            "dependencies": deps,
        })

    by_id = {s[0]: s for s in SERVICES}
    weights = [TRAFFIC[s[0]] for s in SERVICES]
    events = [make_event(by_id[rng.choices([s[0] for s in SERVICES], weights)[0]])
              for _ in range(N_EVENTS)]
    events.sort(key=lambda e: e["ts"]["$date"])

    # Group failing events per service, to attach them to incidents
    pool = {}
    for e in events:
        if e["level"] in ("ERROR", "FATAL"):
            pool.setdefault(e["service_id"], []).append(e)

    incidents = []
    for n in range(1, N_INCIDENTS + 1):
        candidates = [sid for sid, evs in pool.items() if evs]
        if not candidates:
            break
        sid = rng.choice(candidates)
        take = min(rng.randint(1, 3), len(pool[sid]))
        picked = [pool[sid].pop(0) for _ in range(take)]

        first_ts = datetime.strptime(picked[0]["ts"]["$date"], "%Y-%m-%dT%H:%M:%S.000Z").replace(tzinfo=timezone.utc)
        opened = first_ts + timedelta(minutes=rng.randint(1, 10))
        severity = "SEV1" if any(p["level"] == "FATAL" for p in picked) else rng.choice(["SEV2", "SEV3", "SEV3"])
        resolved = rng.random() < 0.85  # a few stay open on purpose
        mttr_min = {"SEV1": rng.randint(45, 180), "SEV2": rng.randint(20, 90), "SEV3": rng.randint(5, 40)}[severity]
        resolved_at = opened + timedelta(minutes=mttr_min)
        actor = rng.choice(ONCALL)

        timeline = [
            {"ts": date(opened), "actor": "pagerduty", "action": "Alert triggered"},
            {"ts": date(opened + timedelta(minutes=2)), "actor": actor, "action": "Acknowledged"},
        ]
        if resolved:
            timeline.append({"ts": date(resolved_at), "actor": actor, "action": "Resolved"})

        doc = {
            "_id": f"INC-{n:04d}",
            "service_id": sid,
            "severity": severity,
            "status": "resolved" if resolved else "investigating",
            "opened_at": date(opened),
            "timeline": timeline,
            "root_cause": rng.choice([
                "Upstream dependency saturated",
                "Bad deploy, rolled back",
                "Connection pool exhausted",
                "Disk pressure on node",
                "Misconfigured timeout",
            ]) if resolved else None,
            "affected_events": [p["_id"] for p in picked],
        }
        if resolved:
            doc["resolved_at"] = date(resolved_at)
        incidents.append(doc)

    return services, events, incidents


def write_jsonl(path, docs):
    with open(path, "w", encoding="utf-8") as fh:
        for d in docs:
            fh.write(json.dumps(d, ensure_ascii=False) + "\n")


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "data")
    out.mkdir(parents=True, exist_ok=True)
    services, events, incidents = build()
    write_jsonl(out / "services.jsonl", services)
    write_jsonl(out / "log_events.jsonl", events)
    write_jsonl(out / "incidents.jsonl", incidents)
    print(f"services={len(services)} log_events={len(events)} incidents={len(incidents)} "
          f"total={len(services) + len(events) + len(incidents)}")


if __name__ == "__main__":
    main()
