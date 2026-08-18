import type { ValidLog } from "../schemas/log.js";
import { pool } from "./pool.js";

interface RollupGroup {
    minuteStart: string;
    service: string;
    level: string;
    count: number;
}

export async function updateRollups(logs: ValidLog[]): Promise<void> {
    if (logs.length === 0) {
        return;
    }

    const groups = new Map<string, RollupGroup>();

    for (const log of logs) {
        const minute = new Date(log.timestamp);

        minute.setUTCSeconds(0, 0);

        const minuteStart = minute.toISOString();

        const key = `${minuteStart}|${log.service}|${log.level}`;

        const existing = groups.get(key);

        if (existing !== undefined) {
            existing.count++;
            continue;
        }

        groups.set(key, {
            minuteStart,
            service: log.service,
            level: log.level,
            count: 1
        });
    }

    const values: unknown[] = [];
    const placeholders: string[] = [];

    let index = 0;

    for (const group of groups.values()) {
        const base = index * 4;

        placeholders.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`
        );

        values.push(
            group.minuteStart,
            group.service,
            group.level,
            group.count
        );

        index++;
    }

    const sql = `
        INSERT INTO log_rollups (
            minute_start,
            service,
            level,
            count
        )
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (minute_start, service, level)
        DO UPDATE
        SET count = log_rollups.count + EXCLUDED.count
    `;

    await pool.query(sql, values);
}