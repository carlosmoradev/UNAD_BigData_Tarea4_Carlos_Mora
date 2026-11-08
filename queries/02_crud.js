// Basic CRUD. Only touches documents it creates itself, so the dataset
// returns to 12 / 170 / 25 documents at the end and the script can be re-run.
const show = (title, value) => { print("\n== " + title); printjson(value); };
const counts = () => ({
  services: db.services.countDocuments({}),
  log_events: db.log_events.countDocuments({}),
  incidents: db.incidents.countDocuments({}),
});

// Start from a clean state in case a previous run was interrupted
db.log_events.deleteMany({ tags: "demo" });
db.incidents.deleteOne({ _id: "INC-9001" });
show("Counts before", counts());

// ---- CREATE -------------------------------------------------------------
show("insertMany: 3 demo log events",
  db.log_events.insertMany([
    { service_id: "payments-api", ts: new Date("2026-11-08T10:00:00Z"), level: "ERROR",
      message: "Timeout calling upstream", latency_ms: 3100,
      http: { method: "POST", path: "/charge", status: 504 }, tags: ["demo", "timeout"] },
    { service_id: "payments-api", ts: new Date("2026-11-08T10:01:00Z"), level: "ERROR",
      message: "Connection reset by peer", latency_ms: 2800,
      http: { method: "POST", path: "/charge", status: 502 }, tags: ["demo", "upstream"] },
    { service_id: "payments-api", ts: new Date("2026-11-08T10:02:00Z"), level: "ERROR",
      message: "Unhandled exception in handler", latency_ms: 1900,
      http: { method: "POST", path: "/charge", status: 500 }, tags: ["demo", "exception"] },
  ]));

const demoIds = db.log_events.find({ tags: "demo" }).toArray().map(e => e._id);
show("insertOne: new incident linked to the demo events",
  db.incidents.insertOne({
    _id: "INC-9001", service_id: "payments-api", severity: "SEV2", status: "investigating",
    opened_at: new Date("2026-11-08T10:03:00Z"),
    timeline: [{ ts: new Date("2026-11-08T10:03:00Z"), actor: "pagerduty", action: "Alert triggered" }],
    root_cause: null, affected_events: demoIds,
  }));

// ---- READ ---------------------------------------------------------------
show("findOne: the incident we just created", db.incidents.findOne({ _id: "INC-9001" }));
show("find + projection + sort + limit: 3 latest ERROR events",
  db.log_events.find({ level: "ERROR" }, { service_id: 1, ts: 1, message: 1, latency_ms: 1 })
    .sort({ ts: -1 }).limit(3).toArray());

// ---- UPDATE -------------------------------------------------------------
show("updateMany with $set and $inc: downgrade demo events and add 100 ms",
  db.log_events.updateMany({ tags: "demo" }, { $set: { level: "WARN" }, $inc: { latency_ms: 100 } }));

show("updateOne with $set and $push: resolve the incident",
  db.incidents.updateOne({ _id: "INC-9001" }, {
    $set: { status: "resolved", resolved_at: new Date("2026-11-08T10:40:00Z"), root_cause: "Misconfigured timeout" },
    $push: { timeline: { ts: new Date("2026-11-08T10:40:00Z"), actor: "Ana Torres", action: "Resolved" } },
  }));
show("After update", db.incidents.findOne({ _id: "INC-9001" }, { status: 1, root_cause: 1, timeline: 1 }));

// ---- DELETE -------------------------------------------------------------
show("deleteMany: demo events", db.log_events.deleteMany({ tags: "demo" }));
show("deleteOne: demo incident", db.incidents.deleteOne({ _id: "INC-9001" }));
show("Counts after (must match 'before')", counts());
