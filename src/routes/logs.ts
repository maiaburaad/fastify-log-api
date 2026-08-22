import type { FastifyInstance } from "fastify";
import { validateLogEntry } from "../schemas/log.js";
import { coalescedInsertLogs } from "../db/ingest-coalescer.js";
import { queryLogs } from "../db/query-logs.js";
import { LOG_LEVELS, type LogLevel } from "../schemas/log.js";
import {
    decodeCursor,
    encodeCursor
} from "../utils/cursor.js";

import {
    aggregateLogs,
    type BucketSize,
    type GroupBy
} from "../db/aggregate-logs.js";



export async function logsRoutes(app: FastifyInstance) {
    app.post("/logs", async (request, reply) => {
        const body = request.body;

        if (
            typeof body !== "object" ||
            body === null ||
            Array.isArray(body) ||
            !("logs" in body) ||
            !Array.isArray(body.logs)
        ) {
            return reply.status(400).send({
                error: "request body must contain a logs array"  //Return 400 when top-level structure is invalid.
            });
        }

        const accepted = [];
        const rejected = [];

        for (let index = 0; index < body.logs.length; index++) {
            const result = validateLogEntry(body.logs[index]);

            if (result.valid) {
                accepted.push(result.log);
            } else {
                rejected.push({
                    index,
                    reason: result.reason
                });
            }
        }

        if (accepted.length === 0) {
            return reply.status(400).send({
                accepted: 0,
                rejected
            });
        }

        await coalescedInsertLogs(accepted);

        return reply.status(200).send({
            accepted: accepted.length,
            rejected
        });
    });



    app.get("/logs", async (request, reply) => {
        const query = request.query as Record<string, unknown>;

        let cursor:
            | {
                timestamp: Date;
                id: string;
            }
            | undefined;

        if (query.cursor !== undefined) {
            if (typeof query.cursor !== "string") {
                return reply.status(400).send({
                    error: "invalid cursor"
                });
            }

            const decoded = decodeCursor(query.cursor);

            if (decoded === null) {
                return reply.status(400).send({
                    error: "invalid cursor"
                });
            }

            cursor = {
                timestamp: new Date(decoded.timestamp),
                id: decoded.id
            };
        }

        const attributes: Record<string, string> = {};

        for (const [key, value] of Object.entries(query)) {
            if (!key.startsWith("attr.")) {
                continue;
            }

            const attributeKey = key.slice("attr.".length);

            if (attributeKey.length === 0) {
                return reply.status(400).send({
                    error: "attribute key must not be empty"
                });
            }

            if (typeof value !== "string") {
                return reply.status(400).send({
                    error: `attribute '${attributeKey}' must have a string value`
                });
            }

            attributes[attributeKey] = value;
        }

        const service =
            typeof query.service === "string"
                ? query.service
                : undefined;

        const level =
            typeof query.level === "string"
                ? query.level
                : undefined;

        const q =
            typeof query.q === "string"
                ? query.q
                : undefined;

        if (
            level !== undefined &&
            !LOG_LEVELS.includes(level as LogLevel)
        ) {
            return reply.status(400).send({
                error: `unsupported level: '${level}'`
            });
        }

        let since: Date | undefined;

        if (query.since !== undefined) {
            if (typeof query.since !== "string") {
                return reply.status(400).send({
                    error: "invalid since timestamp"
                });
            }

            since = new Date(query.since);

            if (Number.isNaN(since.getTime())) {
                return reply.status(400).send({
                    error: "invalid since timestamp"
                });
            }
        }

        let until: Date | undefined;

        if (query.until !== undefined) {
            if (typeof query.until !== "string") {
                return reply.status(400).send({
                    error: "invalid until timestamp"
                });
            }

            until = new Date(query.until);

            if (Number.isNaN(until.getTime())) {
                return reply.status(400).send({
                    error: "invalid until timestamp"
                });
            }
        }

        if (
            since !== undefined &&
            until !== undefined &&
            until.getTime() < since.getTime()
        ) {
            return reply.status(400).send({
                error: "until must not be earlier than since"
            });
        }

        let limit = 100;

        if (query.limit !== undefined) {
            if (
                typeof query.limit !== "string" ||
                !/^\d+$/.test(query.limit)
            ) {
                return reply.status(400).send({
                    error: "limit must be numeric"
                });
            }

            limit = Number(query.limit);

            if (limit < 1 || limit > 1000) {
                return reply.status(400).send({
                    error: "limit must be between 1 and 1000"
                });
            }
        }

        const rows = await queryLogs({
            service,
            level,
            since,
            until,
            q,
            attributes,
            cursor,
            limit
        });

        const hasMore = rows.length > limit;

        const logs = hasMore
            ? rows.slice(0, limit)
            : rows;

        let nextCursor: string | null = null;

        if (hasMore && logs.length > 0) {
            const lastLog = logs[logs.length - 1];

            if (lastLog !== undefined) {
                nextCursor = encodeCursor({
                    timestamp: lastLog.timestamp.toISOString(),
                    id: lastLog.id
                });
            }
        }

        return reply.status(200).send({
            logs,
            next_cursor: nextCursor
        });
    });


    app.get("/logs/aggregate", async (request, reply) => {
        const query = request.query as Record<string, unknown>;

        if (typeof query.since !== "string") {
            return reply.status(400).send({
                error: "since is required and must be a valid timestamp"
            });
        }

        if (typeof query.until !== "string") {
            return reply.status(400).send({
                error: "until is required and must be a valid timestamp"
            });
        }

        const since = new Date(query.since);
        const until = new Date(query.until);

        if (Number.isNaN(since.getTime())) {
            return reply.status(400).send({
                error: "invalid since timestamp"
            });
        }

        if (Number.isNaN(until.getTime())) {
            return reply.status(400).send({
                error: "invalid until timestamp"
            });
        }

        if (until.getTime() < since.getTime()) {
            return reply.status(400).send({
                error: "until must not be earlier than since"
            });
        }

        const allowedBuckets = ["1m", "5m", "1h", "1d"] as const;

        if (
            typeof query.bucket !== "string" ||
            !allowedBuckets.includes(query.bucket as BucketSize)
        ) {
            return reply.status(400).send({
                error: "bucket must be one of: 1m, 5m, 1h, 1d"
            });
        }

        let groupBy: GroupBy | undefined;

        if (query.group_by !== undefined) {
            if (
                query.group_by !== "service" &&
                query.group_by !== "level"
            ) {
                return reply.status(400).send({
                    error: "group_by must be either service or level"
                });
            }

            groupBy = query.group_by;
        }

        const service =
            typeof query.service === "string"
                ? query.service
                : undefined;

        const level =
            typeof query.level === "string"
                ? query.level
                : undefined;

        if (
            level !== undefined &&
            !LOG_LEVELS.includes(level as LogLevel)
        ) {
            return reply.status(400).send({
                error: `unsupported level: '${level}'`
            });
        }

        const q =
            typeof query.q === "string"
                ? query.q
                : undefined;

        const attributes: Record<string, string> = {};

        for (const [key, value] of Object.entries(query)) {
            if (!key.startsWith("attr.")) {
                continue;
            }

            const attributeKey = key.slice("attr.".length);

            if (attributeKey.length === 0) {
                return reply.status(400).send({
                    error: "attribute key must not be empty"
                });
            }

            if (typeof value !== "string") {
                return reply.status(400).send({
                    error: `attribute '${attributeKey}' must have a string value`
                });
            }

            attributes[attributeKey] = value;
        }

        const rows = await aggregateLogs({
            since,
            until,
            bucket: query.bucket as BucketSize,
            groupBy,
            service,
            level,
            q,
            attributes
        });

        const buckets = rows.map((row) => ({
            start: row.start.toISOString(),
            group: row.group,
            count: Number(row.count)
        }));

        return reply.status(200).send({
            buckets
        });
    });
}
