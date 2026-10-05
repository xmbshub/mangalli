CREATE TABLE IF NOT EXISTS api_rate_limits (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  hits integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_rate_limits_updated_idx ON api_rate_limits(updated_at);
