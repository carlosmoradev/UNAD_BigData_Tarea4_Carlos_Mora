// Aggregation pipelines: count, sum, average, min, max, buckets, facets.
const show = (title, value) => { print("\n== " + title); printjson(value && value.toArray ? value.toArray() : value); };

show("Count of events per level",
  db.log_events.aggregate([
    { $group: { _id: "$level", total: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]));

show("Top 5 services by number of ERROR/FATAL events",
  db.log_events.aggregate([
    { $match: { level: { $in: ["ERROR", "FATAL"] } } },
    { $group: { _id: "$service_id", failures: { $sum: 1 } } },
    { $sort: { failures: -1, _id: 1 } },
    { $limit: 5 },
  ]));

show("Latency per service: avg, min, max, sum (only events with latency_ms)",
  db.log_events.aggregate([
    { $match: { latency_ms: { $exists: true } } },
    { $group: {
        _id: "$service_id",
        events: { $sum: 1 },
        avg_ms: { $avg: "$latency_ms" },
        min_ms: { $min: "$latency_ms" },
        max_ms: { $max: "$latency_ms" },
        total_ms: { $sum: "$latency_ms" },
    } },
    { $set: { avg_ms: { $round: ["$avg_ms", 1] } } },
    { $sort: { avg_ms: -1 } },
  ]));

show("Error rate (%) per service",
  db.log_events.aggregate([
    { $group: {
        _id: "$service_id",
        total: { $sum: 1 },
        failures: { $sum: { $cond: [{ $in: ["$level", ["ERROR", "FATAL"]] }, 1, 0] } },
    } },
    { $project: { total: 1, failures: 1, error_rate_pct: { $round: [{ $multiply: [{ $divide: ["$failures", "$total"] }, 100] }, 1] } } },
    { $sort: { error_rate_pct: -1, _id: 1 } },
    { $limit: 5 },
  ]));

show("Latency distribution with $bucket (ms)",
  db.log_events.aggregate([
    { $match: { latency_ms: { $exists: true } } },
    { $bucket: {
        groupBy: "$latency_ms",
        boundaries: [0, 100, 500, 1000, 2000, 5000, 100000],
        default: "other",
        output: { events: { $sum: 1 } },
    } },
  ]));

show("p95 latency of API traffic (sorted array + index)",
  db.log_events.aggregate([
    { $match: { "http.status": { $exists: true } } },
    { $group: { _id: null, all: { $push: "$latency_ms" } } },
    { $project: { _id: 0, samples: { $size: "$all" },
        p95_ms: { $arrayElemAt: [{ $sortArray: { input: "$all", sortBy: 1 } },
                  { $floor: { $multiply: [{ $size: "$all" }, 0.95] } }] } } },
  ]));

show("MTTR (minutes) per severity, resolved incidents only",
  db.incidents.aggregate([
    { $match: { status: "resolved" } },
    { $project: { severity: 1, mttr_min: { $dateDiff: { startDate: "$opened_at", endDate: "$resolved_at", unit: "minute" } } } },
    { $group: { _id: "$severity", incidents: { $sum: 1 }, avg_mttr_min: { $avg: "$mttr_min" }, max_mttr_min: { $max: "$mttr_min" } } },
    { $set: { avg_mttr_min: { $round: ["$avg_mttr_min", 1] } } },
    { $sort: { _id: 1 } },
  ]));

show("Events per day, first 5 days",
  db.log_events.aggregate([
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$ts" } }, events: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $limit: 5 },
  ]));

show("$facet: levels, busiest service and overall stats in a single pass",
  db.log_events.aggregate([
    { $facet: {
        by_level: [{ $group: { _id: "$level", n: { $sum: 1 } } }, { $sort: { n: -1 } }],
        busiest_service: [{ $group: { _id: "$service_id", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 1 }],
        overall: [{ $group: { _id: null, events: { $sum: 1 }, avg_latency_ms: { $avg: "$latency_ms" } } }, { $project: { _id: 0, events: 1, avg_latency_ms: { $round: ["$avg_latency_ms", 1] } } }],
    } },
  ]));
