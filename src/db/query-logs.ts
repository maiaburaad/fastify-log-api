import { pool } from "./pool.js";

export interface LogRow {
    id: string;
    timestamp: Date;
    level: string;
    service: string;
    message: string;
    attributes: Record<string, string | number | boolean>;

}

export interface LogFilters {
    service?: string;  //? => optional
    level?: string;
    since?: Date;
    until?: Date;
    q?: string;
    attributes?: Record<string, string>;
    cursor?: {
        timestamp: Date;
        id: string;
    };
    limit: number;

}

export async function queryLogs(filters: LogFilters): Promise<LogRow[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.service !== undefined) {
        values.push(filters.service);
        conditions.push(`service = $${values.length}`);
    }

    if (filters.level !== undefined) {
        values.push(filters.level);
        conditions.push(`level = $${values.length}`);
    }

    if (filters.since !== undefined) {
        values.push(filters.since);
        conditions.push(`timestamp >= $${values.length}`);
    }

    if (filters.until !== undefined) {
        values.push(filters.until);
        conditions.push(`timestamp < $${values.length}`);
    }

    if (filters.q !== undefined) {
        values.push(`%${filters.q}%`);
        conditions.push(`message ILIKE $${values.length}`); //case-insensitive search
    }


    if (filters.attributes !== undefined) {
        for (const [key, value] of Object.entries(filters.attributes)) {
            values.push(key);
            const keyPlaceholder = `$${values.length}`;

            values.push(value);
            const valuePlaceholder = `$${values.length}`;

            conditions.push(
                `attributes ->> ${keyPlaceholder} = ${valuePlaceholder}`
            );
        }
    }


    if (filters.cursor !== undefined) {
        values.push(filters.cursor.timestamp);
        const timestampPlaceholder = `$${values.length}`;

        values.push(filters.cursor.id);
        const idPlaceholder = `$${values.length}`;

        conditions.push(`
        (
            timestamp < ${timestampPlaceholder}
            OR (
                timestamp = ${timestampPlaceholder}
                AND id < ${idPlaceholder}
            )
        )
    `);
    }

    values.push(filters.limit + 1);

    const limitPlaceholder = `$${values.length}`;

    const whereClause =
        conditions.length > 0
            ? `WHERE ${conditions.join(" AND ")}`
            : "";

    const sql = `
        SELECT
            id,
            timestamp,
            level,
            service,
            message,
            attributes
        FROM logs
        ${whereClause}
        ORDER BY timestamp DESC, id DESC
        LIMIT ${limitPlaceholder}
    `;

    const result = await pool.query<LogRow>(sql, values);

    return result.rows;
}