// Indexes supporting the query patterns used in the other scripts.
const show = (title, value) => { print("\n== " + title); printjson(value); };

db.log_events.createIndex({ service_id: 1, ts: -1 });
db.log_events.createIndex({ level: 1 });
db.incidents.createIndex({ service_id: 1, status: 1 });
db.incidents.createIndex({ severity: 1 });

show("Indexes on log_events", db.log_events.getIndexes().map(i => i.name));
show("Indexes on incidents", db.incidents.getIndexes().map(i => i.name));
