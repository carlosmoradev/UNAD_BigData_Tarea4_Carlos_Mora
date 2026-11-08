// Query optimization evidence (explain) and schema validation ($jsonSchema).
const show = (title, value) => { print("\n== " + title); printjson(value && value.toArray ? value.toArray() : value); };

// ---- PART 1: explain() -- index scan vs collection scan -----------------
// Collect every stage name in a plan tree (FETCH > IXSCAN, COLLSCAN, ...).
const stages = (plan) => {
  if (!plan) return [];
  const own = plan.stage ? [plan.stage] : [];
  const kids = [].concat(plan.inputStage || [], plan.inputStages || []);
  return own.concat(...kids.map(stages));
};
const summary = (explained) => {
  const s = explained.executionStats;
  return {
    plan: stages(explained.queryPlanner.winningPlan).join(" > "),
    index: (function find(p) { return p ? (p.indexName || find(p.inputStage)) : undefined; })(explained.queryPlanner.winningPlan) || null,
    returned: s.nReturned,
    keys_examined: s.totalKeysExamined,
    docs_examined: s.totalDocsExamined,
  };
};

const rangeFilter = { service_id: "payments-api", ts: { $gte: new Date("2026-10-10T00:00:00Z"), $lt: new Date("2026-10-20T00:00:00Z") } };
show("Events of one service in a date range: WITH index {service_id, ts}",
  summary(db.log_events.find(rangeFilter).explain("executionStats")));
show("Same query forced to a collection scan (hint $natural)",
  summary(db.log_events.find(rangeFilter).hint({ $natural: 1 }).explain("executionStats")));

const openFilter = { service_id: "payments-api", status: "investigating" };
show("Open incidents of one service: WITH index {service_id, status}",
  summary(db.incidents.find(openFilter).explain("executionStats")));
show("Same query forced to a collection scan (hint $natural)",
  summary(db.incidents.find(openFilter).hint({ $natural: 1 }).explain("executionStats")));

// ---- PART 2: schema validation -----------------------------------------
const serviceSchema = {
  bsonType: "object",
  required: ["_id", "team", "tier", "env", "region", "owner", "dependencies"],
  properties: {
    _id: { bsonType: "string" },
    team: { bsonType: "string" },
    tier: { bsonType: "number", minimum: 1, maximum: 3 },
    env: { enum: ["prod", "staging", "dev"] },
    region: { bsonType: "string" },
    owner: { bsonType: "object", required: ["name", "oncall"] },
    dependencies: { bsonType: "array", items: { bsonType: "string" } },
  },
};
const eventSchema = {
  bsonType: "object",
  required: ["service_id", "ts", "level", "message"],   // http / meta stay optional on purpose
  properties: {
    service_id: { bsonType: "string" },
    ts: { bsonType: "date" },
    level: { enum: ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"] },
    message: { bsonType: "string" },
    latency_ms: { bsonType: "number", minimum: 0 },
    query_ms: { bsonType: "number", minimum: 0 },
    tags: { bsonType: "array", items: { bsonType: "string" } },
    http: { bsonType: "object", properties: { status: { bsonType: "number", minimum: 100, maximum: 599 } } },
    meta: { bsonType: "object" },
  },
};
const incidentSchema = {
  bsonType: "object",
  required: ["_id", "service_id", "severity", "status", "opened_at", "timeline", "affected_events"],
  properties: {
    _id: { bsonType: "string" },
    service_id: { bsonType: "string" },
    severity: { enum: ["SEV1", "SEV2", "SEV3"] },
    status: { enum: ["investigating", "resolved"] },
    opened_at: { bsonType: "date" },
    resolved_at: { bsonType: "date" },
    root_cause: { bsonType: ["string", "null"] },
    timeline: { bsonType: "array", items: { bsonType: "object", required: ["ts", "actor", "action"] } },
    affected_events: { bsonType: "array", items: { bsonType: "objectId" } },
  },
};

const validators = { services: serviceSchema, log_events: eventSchema, incidents: incidentSchema };
for (const [coll, schema] of Object.entries(validators)) {
  db.runCommand({ collMod: coll, validator: { $jsonSchema: schema }, validationLevel: "strict", validationAction: "error" });
}
show("Validators installed", Object.keys(validators).map(c => ({ collection: c, has_validator: !!db.getCollectionInfos({ name: c })[0].options.validator })));

show("Existing documents that violate their schema (must be 0 everywhere)",
  Object.fromEntries(Object.entries(validators).map(([c, s]) => [c, db[c].countDocuments({ $nor: [{ $jsonSchema: s }] })])));

const attempt = (title, doc) => {
  try { db.log_events.insertOne(doc); print("\n== " + title + "\ninserted (unexpected)"); db.log_events.deleteOne({ tags: "validation-demo" }); }
  catch (e) { show(title, { rejected: true, code: e.code, error: e.message }); }
};
attempt("Invalid level 'TRACE' is rejected",
  { service_id: "gateway", ts: new Date(), level: "TRACE", message: "x", tags: ["validation-demo"] });
attempt("Negative latency is rejected",
  { service_id: "gateway", ts: new Date(), level: "INFO", message: "x", latency_ms: -5, tags: ["validation-demo"] });
attempt("Missing required field 'message' is rejected",
  { service_id: "gateway", ts: new Date(), level: "INFO", tags: ["validation-demo"] });

const ok = db.log_events.insertOne({ service_id: "queue-broker", ts: new Date(), level: "INFO", message: "Valid event without http or meta", tags: ["validation-demo"] });
show("Valid event without http/meta is accepted", { acknowledged: ok.acknowledged });
db.log_events.deleteMany({ tags: "validation-demo" });
show("Counts after cleanup (12 / 170 / 25)",
  { services: db.services.countDocuments({}), log_events: db.log_events.countDocuments({}), incidents: db.incidents.countDocuments({}) });
