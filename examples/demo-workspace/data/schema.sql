CREATE TABLE services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  environment TEXT NOT NULL,
  availability REAL NOT NULL,
  latency_ms INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE releases (
  id INTEGER PRIMARY KEY,
  version TEXT NOT NULL,
  released_at TEXT NOT NULL,
  owner TEXT NOT NULL
);
