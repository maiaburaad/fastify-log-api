CREATE TABLE IF NOT EXISTS log_rollups (
    minute_start TIMESTAMPTZ NOT NULL,
    service TEXT NOT NULL,
    level TEXT NOT NULL,
    count BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY (minute_start, service, level)
);

INSERT INTO log_rollups (
    minute_start,
    service,
    level,
    count
)
SELECT
    date_trunc('minute', timestamp) AS minute_start,
    service,
    level,
    COUNT(*) AS count
FROM logs
GROUP BY
    date_trunc('minute', timestamp),
    service,
    level;