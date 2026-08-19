import type { ValidLog } from "../schemas/log.js";
import { pool } from "./pool.js";

export async function insertLogs(logs: ValidLog[]): Promise<void> {
    if (logs.length === 0) {
        return;
    }

    const values: unknown[] = [];
    const placeholders: string[] = [];

    logs.forEach((log, index) => {
        const base = index * 5;

        placeholders.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
        );

        values.push(
            log.timestamp,
            log.level,
            log.service,
            log.message,
            JSON.stringify(log.attributes)
        );
    });

    const sql = `
        WITH inserted AS (
            INSERT INTO logs (
                timestamp,
                level,
                service,
                message,
                attributes
            )
            VALUES ${placeholders.join(", ")}
            RETURNING
                timestamp,
                service,
                level
        ),
        rollup_counts AS (
            SELECT
                date_trunc('minute', timestamp) AS minute_start,
                service,
                level,
                COUNT(*) AS count
            FROM inserted
            GROUP BY
                date_trunc('minute', timestamp),
                service,
                level
        )
        INSERT INTO log_rollups (
            minute_start,
            service,
            level,
            count
        )
        SELECT
            minute_start,
            service,
            level,
            count
        FROM rollup_counts
        ON CONFLICT (minute_start, service, level)
        DO UPDATE
        SET count = log_rollups.count + EXCLUDED.count
    `;

    await pool.query(sql, values);
}