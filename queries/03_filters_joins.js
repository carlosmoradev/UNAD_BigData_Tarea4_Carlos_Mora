// Filters, operators and joins ($lookup).
const show = (title, value) => { print("\n== " + title); printjson(value && value.toArray ? value.toArray() : value); };

// ---- FILTERS AND OPERATORS ---------------------------------------------
show("$gt: events slower than 4000 ms (count)", db.log_events.countDocuments({ latency_ms: { $gt: 4000 } }));

show("$and / $or: critical events on tier-1 payment services",
  db.log_events.find({
    $and: [
      { $or: [{ level: "ERROR" }, { level: "FATAL" }] },
      { service_id: { $in: ["payments-api", "billing-worker"] } },
    ],
  }, { service_id: 1, level: 1, message: 1 }).limit(5));

show("$nin: events NOT from infrastructure services (count)",
  db.log_events.countDocuments({ service_id: { $nin: ["postgres-main", "redis-cache", "queue-broker"] } }));

show("$exists: events without an http block (workers and databases) (count)",
  db.log_events.countDocuments({ http: { $exists: false } }));

show("$regex: messages mentioning a timeout (case-insensitive) (count)",
  db.log_events.countDocuments({ message: { $regex: /timed? ?out/i } }));

show("$gte / $lt: events during the first week of October (count)",
  db.log_events.countDocuments({ ts: { $gte: new Date("2026-10-01T00:00:00Z"), $lt: new Date("2026-10-08T00:00:00Z") } }));

show("$all: services that depend on BOTH auth-svc and postgres-main",
  db.services.find({ dependencies: { $all: ["auth-svc", "postgres-main"] } }, { team: 1, dependencies: 1 }));

show("$size: incidents with a complete 3-step timeline (count)",
  db.incidents.countDocuments({ timeline: { $size: 3 } }));

show("Nested field: events with an HTTP 5xx status (count)",
  db.log_events.countDocuments({ "http.status": { $gte: 500 } }));

// ---- JOINS ($lookup) ----------------------------------------------------
show("Join 1: ERROR events with the owning service (events -> services)",
  db.log_events.aggregate([
    { $match: { level: "ERROR" } },
    { $limit: 3 },
    { $lookup: { from: "services", localField: "service_id", foreignField: "_id", as: "service" } },
    { $unwind: "$service" },
    { $project: { _id: 0, message: 1, service_id: 1, team: "$service.team", tier: "$service.tier", oncall: "$service.owner.oncall" } },
  ]));

show("Join 2: incidents with their events (incidents -> log_events via array of ids)",
  db.incidents.aggregate([
    { $match: { status: "investigating" } },
    { $lookup: { from: "log_events", localField: "affected_events", foreignField: "_id", as: "events" } },
    { $project: { severity: 1, service_id: 1, event_count: { $size: "$events" }, messages: "$events.message" } },
  ]));

show("Join 3: incident count per team (incidents -> services)",
  db.incidents.aggregate([
    { $lookup: { from: "services", localField: "service_id", foreignField: "_id", as: "svc" } },
    { $unwind: "$svc" },
    { $group: { _id: "$svc.team", incidents: { $sum: 1 } } },
    { $sort: { incidents: -1, _id: 1 } },
  ]));
