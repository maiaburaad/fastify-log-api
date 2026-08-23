TRUNCATE TABLE log_rollups;

INSERT INTO log_rollups (
    minute_start,
    service,
    level,
    shard,
    count
)
SELECT
    date_bin(
        '5 seconds',
        timestamp,
        TIMESTAMPTZ '2026-01-01 00:00:00+00'
    ) AS minute_start,
    service,
    level,
    0 AS shard,
    COUNT(*) AS count
FROM logs
GROUP BY
    date_bin(
        '5 seconds',
        timestamp,
        TIMESTAMPTZ '2026-01-01 00:00:00+00'
    ),
    service,
    level;