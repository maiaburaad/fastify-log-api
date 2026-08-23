ALTER TABLE log_rollups
ADD COLUMN IF NOT EXISTS shard SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE log_rollups
DROP CONSTRAINT IF EXISTS log_rollups_pkey;

ALTER TABLE log_rollups
ADD CONSTRAINT log_rollups_pkey
PRIMARY KEY (
    minute_start,
    service,
    level,
    shard
);