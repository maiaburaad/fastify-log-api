interface RateLimitState {
    windowStart: number;
    requestCount: number;
}

const WINDOW_MS = 1000;

const state: RateLimitState = {
    windowStart: Date.now(),
    requestCount: 0
};

function getRateLimit(): number | null {
    const raw = process.env.RATE_LIMIT_REQUESTS_PER_SECOND;

    if (raw === undefined) {
        return null;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value <= 0) {
        return null;
    }

    return value;
}

export function isRateLimited(): boolean {
    const limit = getRateLimit();

    // Rate limiting is OFF by default.
    if (limit === null) {
        return false;
    }

    const now = Date.now();

    if (now - state.windowStart >= WINDOW_MS) {
        state.windowStart = now;
        state.requestCount = 0;
    }

    if (state.requestCount >= limit) {
        return true;
    }

    state.requestCount++;

    return false;
}