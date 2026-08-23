import {
    type AggregateFilters,
    type BucketSize,
    type GroupBy
} from "../db/aggregate-logs.js";

import {
    LOG_LEVELS,
    type LogLevel
} from "../schemas/log.js";

type ParseResult =
    | {
        ok: true;
        filters: AggregateFilters;
    }
    | {
        ok: false;
        error: string;
    };

export function parseAggregateQuery(
    query: Record<string, unknown>
): ParseResult {
    if (typeof query.since !== "string") {
        return {
            ok: false,
            error: "since is required and must be a valid timestamp"
        };
    }

    if (typeof query.until !== "string") {
        return {
            ok: false,
            error: "until is required and must be a valid timestamp"
        };
    }

    const since = new Date(query.since);
    const until = new Date(query.until);

    if (Number.isNaN(since.getTime())) {
        return {
            ok: false,
            error: "invalid since timestamp"
        };
    }

    if (Number.isNaN(until.getTime())) {
        return {
            ok: false,
            error: "invalid until timestamp"
        };
    }

    if (until.getTime() < since.getTime()) {
        return {
            ok: false,
            error: "until must not be earlier than since"
        };
    }

    const allowedBuckets = [
        "1m",
        "5m",
        "1h",
        "1d"
    ] as const;

    if (
        typeof query.bucket !== "string" ||
        !allowedBuckets.includes(
            query.bucket as BucketSize
        )
    ) {
        return {
            ok: false,
            error: "bucket must be one of: 1m, 5m, 1h, 1d"
        };
    }

    let groupBy: GroupBy | undefined;

    if (query.group_by !== undefined) {
        if (
            query.group_by !== "service" &&
            query.group_by !== "level"
        ) {
            return {
                ok: false,
                error: "group_by must be either service or level"
            };
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
        return {
            ok: false,
            error: `unsupported level: '${level}'`
        };
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

        const attributeKey =
            key.slice("attr.".length);

        if (attributeKey.length === 0) {
            return {
                ok: false,
                error: "attribute key must not be empty"
            };
        }

        if (typeof value !== "string") {
            return {
                ok: false,
                error: `attribute '${attributeKey}' must have a string value`
            };
        }

        attributes[attributeKey] = value;
    }

    return {
        ok: true,
        filters: {
            since,
            until,
            bucket: query.bucket as BucketSize,
            groupBy,
            service,
            level,
            q,
            attributes
        }
    };
}