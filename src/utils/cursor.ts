export interface LogCursor {
    timestamp: string;
    id: string;
}

export function encodeCursor(cursor: LogCursor): string {
    return Buffer
        .from(JSON.stringify(cursor))
        .toString("base64url");
}

export function decodeCursor(value: string): LogCursor | null {
    try {
        const decoded = Buffer
            .from(value, "base64url")
            .toString("utf8");

        const parsed: unknown = JSON.parse(decoded);

        if (
            typeof parsed !== "object" ||
            parsed === null ||
            !("timestamp" in parsed) ||
            !("id" in parsed) ||
            typeof parsed.timestamp !== "string" ||
            typeof parsed.id !== "string"
        ) {
            return null;
        }

        const timestamp = new Date(parsed.timestamp);

        if (Number.isNaN(timestamp.getTime())) {
            return null;
        }

        if (!/^\d+$/.test(parsed.id)) {
            return null;
        }

        return {
            timestamp: parsed.timestamp,
            id: parsed.id
        };
    } catch {
        return null;
    }
}