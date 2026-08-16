export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogAttributeValue = string | number | boolean;

export interface ValidLog {
    timestamp: Date;
    level: LogLevel;
    service: string;
    message: string;
    attributes: Record<string, LogAttributeValue>;
}

export type ValidationResult =
    | {
        valid: true;
        log: ValidLog;
    }
    | {
        valid: false;
        reason: string;
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

function isValidIso8601(value: string): boolean {
    const iso8601Regex =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

    if (!iso8601Regex.test(value)) {
        return false;
    }

    const timestamp = new Date(value);

    return !Number.isNaN(timestamp.getTime());
}

export function validateLogEntry(value: unknown): ValidationResult {
    if (!isPlainObject(value)) {
        return {
            valid: false,
            reason: "log entry must be an object"
        };
    }

    if (typeof value.timestamp !== "string") {
        return {
            valid: false,
            reason: "timestamp is required and must be a string"
        };
    }

    if (!isValidIso8601(value.timestamp)) {
        return {
            valid: false,
            reason: "invalid timestamp"
        };
    }

    const timestamp = new Date(value.timestamp);

    const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;

    if (timestamp.getTime() > fiveMinutesFromNow) {
        return {
            valid: false,
            reason: "timestamp must not be more than five minutes in the future"
        };
    }

    if (
        typeof value.level !== "string" ||
        !LOG_LEVELS.includes(value.level as LogLevel)
    ) {
        return {
            valid: false,
            reason: `invalid level: '${String(value.level)}'`
        };
    }

    if (
        typeof value.service !== "string" ||
        value.service.trim().length === 0
    ) {
        return {
            valid: false,
            reason: "service is required and must be a non-empty string"
        };
    }

    if (
        typeof value.message !== "string" ||
        value.message.trim().length === 0
    ) {
        return {
            valid: false,
            reason: "message is required and must be a non-empty string"
        };
    }

    let attributes: Record<string, LogAttributeValue> = {};

    if (value.attributes !== undefined) {
        if (!isPlainObject(value.attributes)) {  ////check the Flat Object
            return {
                valid: false,
                reason: "attributes must be a flat object"
            };
        }

        for (const [key, attributeValue] of Object.entries(value.attributes)) {
            const type = typeof attributeValue;

            if (
                type !== "string" &&
                type !== "number" &&
                type !== "boolean"
            ) {
                return {
                    valid: false,
                    reason: `attribute '${key}' must be a string, number, or boolean`
                };
            }
        }

        attributes = value.attributes as Record<string, LogAttributeValue>;
    }

    return {
        valid: true,
        log: {
            timestamp,
            level: value.level as LogLevel,
            service: value.service,
            message: value.message,
            attributes
        }
    };
}