import { pool } from "./pool.js";

export type BucketSize = "1m" | "5m" | "1h" | "1d";
export type GroupBy = "service" | "level";

export interface AggregateFilters {
    since: Date;
    until: Date;
    bucket: BucketSize;
    groupBy?: GroupBy;
    service?: string;
    level?: string;
    q?: string;
    attributes?: Record<string, string>;
}

export interface AggregateRow {
    start: Date;
    group: string | null;
    count: string;
}

const ROLLUP_BUCKET_MS = 5_000;

function ceilRollupBucket(date: Date): Date {
    const time = date.getTime();

    return new Date(
        Math.ceil(time / ROLLUP_BUCKET_MS) * ROLLUP_BUCKET_MS
    );
}

function floorRollupBucket(date: Date): Date {
    const time = date.getTime();

    return new Date(
        Math.floor(time / ROLLUP_BUCKET_MS) * ROLLUP_BUCKET_MS
    );
}

function getRawBucketExpression(bucket: BucketSize): string {
    switch (bucket) {
        case "1m":
            return "date_trunc('minute', timestamp)";

        case "5m":
            return `
                to_timestamp(
                    floor(extract(epoch from timestamp) / 300) * 300
                )
            `;

        case "1h":
            return "date_trunc('hour', timestamp)";

        case "1d":
            return "date_trunc('day', timestamp)";
    }
}

function getRollupBucketExpression(bucket: BucketSize): string {
    switch (bucket) {
        case "1m":
            return "date_trunc('minute', minute_start)";

        case "5m":
            return `
                to_timestamp(
                    floor(extract(epoch from minute_start) / 300) * 300
                )
            `;

        case "1h":
            return "date_trunc('hour', minute_start)";

        case "1d":
            return "date_trunc('day', minute_start)";
    }
}

async function aggregateFromRollups(
    filters: AggregateFilters
): Promise<AggregateRow[]> {
    const interiorStart =
        ceilRollupBucket(filters.since);

    const interiorEnd =
        floorRollupBucket(filters.until);


    if (interiorEnd.getTime() <= interiorStart.getTime()) {
        return aggregateFromRawLogs(filters);
    }

    const values: unknown[] = [];
    const unionParts: string[] = [];


    values.push(interiorStart);
    const interiorStartPlaceholder = `$${values.length}`;

    values.push(interiorEnd);
    const interiorEndPlaceholder = `$${values.length}`;

    const rollupConditions: string[] = [
        `minute_start >= ${interiorStartPlaceholder}`,
        `minute_start < ${interiorEndPlaceholder}`
    ];

    if (filters.service !== undefined) {
        values.push(filters.service);

        rollupConditions.push(
            `service = $${values.length}`
        );
    }

    if (filters.level !== undefined) {
        values.push(filters.level);

        rollupConditions.push(
            `level = $${values.length}`
        );
    }

    unionParts.push(`
        SELECT
            minute_start,
            service,
            level,
            SUM(count) AS count
        FROM log_rollups
        WHERE ${rollupConditions.join(" AND ")}
        GROUP BY
            minute_start,
            service,
            level
    `);


    if (filters.since.getTime() < interiorStart.getTime()) {
        const edgeConditions: string[] = [];

        values.push(filters.since);
        edgeConditions.push(
            `timestamp >= $${values.length}`
        );

        values.push(interiorStart);
        edgeConditions.push(
            `timestamp < $${values.length}`
        );

        if (filters.service !== undefined) {
            values.push(filters.service);

            edgeConditions.push(
                `service = $${values.length}`
            );
        }

        if (filters.level !== undefined) {
            values.push(filters.level);

            edgeConditions.push(
                `level = $${values.length}`
            );
        }

        unionParts.push(`
            SELECT
                date_bin(
                    '5 seconds',
                    timestamp,
                    TIMESTAMPTZ '2026-01-01 00:00:00+00'
                ) AS minute_start,
                service,
                level,
                COUNT(*) AS count
            FROM logs
            WHERE ${edgeConditions.join(" AND ")}
            GROUP BY
                date_bin(
                    '5 seconds',
                    timestamp,
                    TIMESTAMPTZ '2026-01-01 00:00:00+00'
                ),
                service,
                level
        `);
    }


    if (interiorEnd.getTime() < filters.until.getTime()) {
        const edgeConditions: string[] = [];

        values.push(interiorEnd);
        edgeConditions.push(
            `timestamp >= $${values.length}`
        );

        values.push(filters.until);
        edgeConditions.push(
            `timestamp < $${values.length}`
        );

        if (filters.service !== undefined) {
            values.push(filters.service);

            edgeConditions.push(
                `service = $${values.length}`
            );
        }

        if (filters.level !== undefined) {
            values.push(filters.level);

            edgeConditions.push(
                `level = $${values.length}`
            );
        }

        unionParts.push(`
            SELECT
                date_bin(
                    '5 seconds',
                    timestamp,
                    TIMESTAMPTZ '2026-01-01 00:00:00+00'
                ) AS minute_start,
                service,
                level,
                COUNT(*) AS count
            FROM logs
            WHERE ${edgeConditions.join(" AND ")}
            GROUP BY
                date_bin(
                    '5 seconds',
                    timestamp,
                    TIMESTAMPTZ '2026-01-01 00:00:00+00'
                ),
                service,
                level
        `);
    }

    const bucketExpression =
        getRollupBucketExpression(filters.bucket);

    let groupExpression = "NULL";

    if (filters.groupBy === "service") {
        groupExpression = "service";
    }

    if (filters.groupBy === "level") {
        groupExpression = "level";
    }

    const groupByParts = [bucketExpression];

    if (filters.groupBy !== undefined) {
        groupByParts.push(groupExpression);
    }

    const sql = `
        WITH rollup_parts AS (
            ${unionParts.join("\nUNION ALL\n")}
        )
        SELECT
            ${bucketExpression} AS start,
            ${groupExpression} AS "group",
            SUM(count) AS count
        FROM rollup_parts
        GROUP BY ${groupByParts.join(", ")}
        ORDER BY start ASC
    `;

    const result =
        await pool.query<AggregateRow>(sql, values);

    return result.rows;
}

async function aggregateFromRawLogs(
    filters: AggregateFilters
): Promise<AggregateRow[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    values.push(filters.since);
    conditions.push(`timestamp >= $${values.length}`);

    values.push(filters.until);
    conditions.push(`timestamp < $${values.length}`);

    if (filters.service !== undefined) {
        values.push(filters.service);
        conditions.push(`service = $${values.length}`);
    }

    if (filters.level !== undefined) {
        values.push(filters.level);
        conditions.push(`level = $${values.length}`);
    }

    if (filters.q !== undefined) {
        values.push(`%${filters.q}%`);
        conditions.push(
            `message ILIKE $${values.length}`
        );
    }

    if (filters.attributes !== undefined) {
        for (
            const [key, value]
            of Object.entries(filters.attributes)
        ) {
            values.push(key);
            const keyPlaceholder = `$${values.length}`;

            values.push(value);
            const valuePlaceholder = `$${values.length}`;

            conditions.push(
                `attributes ->> ${keyPlaceholder} = ${valuePlaceholder}`
            );
        }
    }

    const bucketExpression =
        getRawBucketExpression(filters.bucket);

    let groupExpression = "NULL";

    if (filters.groupBy === "service") {
        groupExpression = "service";
    }

    if (filters.groupBy === "level") {
        groupExpression = "level";
    }

    const groupByParts = [bucketExpression];

    if (filters.groupBy !== undefined) {
        groupByParts.push(groupExpression);
    }

    const sql = `
        SELECT
            ${bucketExpression} AS start,
            ${groupExpression} AS "group",
            COUNT(*) AS count
        FROM logs
        WHERE ${conditions.join(" AND ")}
        GROUP BY ${groupByParts.join(", ")}
        ORDER BY start ASC
    `;

    const result =
        await pool.query<AggregateRow>(sql, values);

    return result.rows;
}

export async function aggregateLogs(
    filters: AggregateFilters
): Promise<AggregateRow[]> {
    const hasAttributeFilters =
        filters.attributes !== undefined &&
        Object.keys(filters.attributes).length > 0;

    const needsRawLogs =
        filters.q !== undefined ||
        hasAttributeFilters;

    if (needsRawLogs) {
        return aggregateFromRawLogs(filters);
    }

    return aggregateFromRollups(filters);
}