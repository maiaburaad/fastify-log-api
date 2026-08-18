CREATE INDEX IF NOT EXISTS idx_logs_timestamp_id
ON logs (timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_logs_service_timestamp_id
ON logs (service, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_logs_level_timestamp_id
ON logs (level, timestamp DESC, id DESC);