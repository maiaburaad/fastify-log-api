import { pool } from "./pool.js";

const DEFAULT_RETENTION_DAYS = 30;
const RETENTION_BATCH_SIZE = 5000;

const ROLLUP_BUCKET_MS = 5_000;

function getRetentionDays(): number {
    const raw = process.env.RETENTION_DAYS;

    if (raw === undefined) {
        return DEFAULT_RETENTION_DAYS;
    }

    const days = Number(raw);

    if (!Number.isInteger(days) || days <= 0) {
        return DEFAULT_RETENTION_DAYS;
    }

    return days;
}

export async function deleteExpiredLogs(): Promise<number> {
    const retentionDays = getRetentionDays();

    const cutoff = new Date(
        Date.now() -
        retentionDays * 24 * 60 * 60 * 1000
    );

    let totalDeleted = 0;

    while (true) {
        const result = await pool.query(
            `
            WITH expired AS (
                SELECT id
                FROM logs
                WHERE timestamp < $1
                ORDER BY timestamp ASC, id ASC
                LIMIT $2
            )
            DELETE FROM logs AS l
            USING expired AS e
            WHERE l.id = e.id
            RETURNING l.id
            `,
            [cutoff, RETENTION_BATCH_SIZE]
        );

        const deleted = result.rowCount ?? 0;

        totalDeleted += deleted;

        if (deleted < RETENTION_BATCH_SIZE) {
            break;
        }
    }

    if (totalDeleted === 0) {
        return 0;
    }

    const boundaryStart = new Date(
        Math.floor(cutoff.getTime() / ROLLUP_BUCKET_MS) *
        ROLLUP_BUCKET_MS
    );

    const boundaryEnd = new Date(
        boundaryStart.getTime() + ROLLUP_BUCKET_MS
    );

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await client.query(
            `
            DELETE FROM log_rollups
            WHERE minute_start < $1
            `,
            [boundaryStart]
        );

        await client.query(
            `
            DELETE FROM log_rollups
            WHERE minute_start = $1
            `,
            [boundaryStart]
        );

        await client.query(
            `
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
            WHERE timestamp >= $1
              AND timestamp < $2
            GROUP BY
                date_bin(
                    '5 seconds',
                    timestamp,
                    TIMESTAMPTZ '2026-01-01 00:00:00+00'
                ),
                service,
                level
            `,
            [cutoff, boundaryEnd]
        );

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }

    return totalDeleted;
}