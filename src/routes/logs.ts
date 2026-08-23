import type { FastifyInstance } from "fastify";

import {
    validateLogEntry
} from "../schemas/log.js";

import {
    BackpressureError,
    coalescedInsertLogs
} from "../db/ingest-coalescer.js";

import {
    queryLogs
} from "../db/query-logs.js";

import {
    aggregateLogs
} from "../db/aggregate-logs.js";

import {
    encodeCursor
} from "../utils/cursor.js";

import {
    isRateLimited
} from "../rate-limit.js";

import {
    parseLogQuery
} from "../validation/log-query.js";

import {
    parseAggregateQuery
} from "../validation/aggregate-query.js";


export async function logsRoutes(
    app: FastifyInstance
) {
    app.post("/logs", async (request, reply) => {
        if (isRateLimited()) {
            reply.header("Retry-After", "1");

            return reply.status(429).send({
                error: "too many requests"
            });
        }

        const body = request.body;

        if (
            typeof body !== "object" ||
            body === null ||
            Array.isArray(body) ||
            !("logs" in body) ||
            !Array.isArray(body.logs)
        ) {
            return reply.status(400).send({
                error: "request body must contain a logs array"
            });
        }

        const accepted = [];
        const rejected = [];

        for (
            let index = 0;
            index < body.logs.length;
            index++
        ) {
            const result =
                validateLogEntry(body.logs[index]);

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

        try {
            await coalescedInsertLogs(accepted);
        } catch (error) {
            if (
                error instanceof BackpressureError
            ) {
                reply.header("Retry-After", "1");

                return reply.status(503).send({
                    error:
                        "service temporarily overloaded"
                });
            }

            throw error;
        }

        return reply.status(200).send({
            accepted: accepted.length,
            rejected
        });
    });


    app.get("/logs", async (request, reply) => {
        const query =
            request.query as Record<
                string,
                unknown
            >;

        const parsed = parseLogQuery(query);

        if (!parsed.ok) {
            return reply.status(400).send({
                error: parsed.error
            });
        }

        const rows =
            await queryLogs(parsed.filters);

        const hasMore =
            rows.length > parsed.filters.limit;

        const logs = hasMore
            ? rows.slice(
                0,
                parsed.filters.limit
            )
            : rows;

        let nextCursor: string | null = null;

        if (hasMore && logs.length > 0) {
            const lastLog =
                logs[logs.length - 1];

            if (lastLog !== undefined) {
                nextCursor = encodeCursor({
                    timestamp:
                        lastLog.timestamp.toISOString(),
                    id: lastLog.id
                });
            }
        }

        return reply.status(200).send({
            logs,
            next_cursor: nextCursor
        });
    });


    app.get(
        "/logs/aggregate",
        async (request, reply) => {
            const query =
                request.query as Record<
                    string,
                    unknown
                >;

            const parsed =
                parseAggregateQuery(query);

            if (!parsed.ok) {
                return reply.status(400).send({
                    error: parsed.error
                });
            }

            const rows =
                await aggregateLogs(
                    parsed.filters
                );

            const buckets = rows.map(
                (row) => ({
                    start:
                        row.start.toISOString(),
                    group: row.group,
                    count: Number(row.count)
                })
            );

            return reply.status(200).send({
                buckets
            });
        }
    );
}