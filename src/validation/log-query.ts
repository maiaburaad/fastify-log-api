import type { LogFilters } from "../db/query-logs.js";
import { LOG_LEVELS, type LogLevel } from "../schemas/log.js";
import { decodeCursor } from "../utils/cursor.js";

type ParseResult =
    | {
        ok: true;
        filters: LogFilters;
    }
    | {
        ok: false;
        error: string;
    };

export function parseLogQuery(
    query: Record<string, unknown>
): ParseResult {
    let cursor:
        | {
            timestamp: Date;
            id: string;
        }
        | undefined;

    if (query.cursor !== undefined) {
        if (typeof query.cursor !== "string") {
            return {
                ok: false,
                error: "invalid cursor"
            };
        }

        const decoded = decodeCursor(query.cursor);

        if (decoded === null) {
            return {
                ok: false,
                error: "invalid cursor"
            };
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
        return {
            ok: false,
            error: `unsupported level: '${level}'`
        };
    }

    let since: Date | undefined;

    if (query.since !== undefined) {
        if (typeof query.since !== "string") {
            return {
                ok: false,
                error: "invalid since timestamp"
            };
        }

        since = new Date(query.since);

        if (Number.isNaN(since.getTime())) {
            return {
                ok: false,
                error: "invalid since timestamp"
            };
        }
    }

    let until: Date | undefined;

    if (query.until !== undefined) {
        if (typeof query.until !== "string") {
            return {
                ok: false,
                error: "invalid until timestamp"
            };
        }

        until = new Date(query.until);

        if (Number.isNaN(until.getTime())) {
            return {
                ok: false,
                error: "invalid until timestamp"
            };
        }
    }

    if (
        since !== undefined &&
        until !== undefined &&
        until.getTime() < since.getTime()
    ) {
        return {
            ok: false,
            error: "until must not be earlier than since"
        };
    }

    let limit = 100;

    if (query.limit !== undefined) {
        if (
            typeof query.limit !== "string" ||
            !/^\d+$/.test(query.limit)
        ) {
            return {
                ok: false,
                error: "limit must be numeric"
            };
        }

        limit = Number(query.limit);

        if (limit < 1 || limit > 1000) {
            return {
                ok: false,
                error: "limit must be between 1 and 1000"
            };
        }
    }

    return {
        ok: true,
        filters: {
            service,
            level,
            since,
            until,
            q,
            attributes,
            cursor,
            limit
        }
    };
}