-- State and lease share one row so publishing a refresh is atomic in D1.batch.
CREATE TABLE IF NOT EXISTS runtime_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  snapshot_json TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_error TEXT,
  lease_owner TEXT,
  lease_until TEXT,
  last_commit_id TEXT
);
INSERT OR IGNORE INTO runtime_state (id) VALUES (1);

CREATE TABLE IF NOT EXISTS status_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS status_events_project_date
  ON status_events (project_id, effective_at DESC);
