import { pool } from "./pool.js";

const DEFAULT_RETENTION_DAYS = 30;
const RETENTION_BATCH_SIZE = 5000;

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

    let totalDeleted = 0;

    while (true) {
        const result = await pool.query(
            `
            WITH expired AS (
                SELECT id
                FROM logs
                WHERE timestamp < NOW() - ($1::int * INTERVAL '1 day')
                ORDER BY timestamp ASC, id ASC
                LIMIT $2
            )
            DELETE FROM logs AS l
            USING expired AS e
            WHERE l.id = e.id
            RETURNING l.id
            `,
            [retentionDays, RETENTION_BATCH_SIZE]
        );

        const deleted = result.rowCount ?? 0;

        totalDeleted += deleted;

        if (deleted < RETENTION_BATCH_SIZE) {
            break;
        }
    }

    return totalDeleted;
}