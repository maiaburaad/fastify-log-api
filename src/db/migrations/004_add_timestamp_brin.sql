CREATE INDEX IF NOT EXISTS idx_logs_timestamp_brin
ON logs
USING BRIN (timestamp);