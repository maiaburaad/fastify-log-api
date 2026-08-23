import type { ValidLog } from "../schemas/log.js";
import { insertLogs } from "./insert-logs.js";

const COALESCE_WINDOW_MS = 10;
const MAX_BATCH_ENTRIES = 10_000;

const DEFAULT_MAX_IN_FLIGHT_LOGS = 50_000;

interface PendingRequest {
    logs: ValidLog[];
    resolve: () => void;
    reject: (error: unknown) => void;
}

export class BackpressureError extends Error {
    constructor() {
        super("ingestion temporarily overloaded");
        this.name = "BackpressureError";
    }
}

let pending: PendingRequest[] = [];
let pendingLogCount = 0;
let inFlightLogCount = 0;
let timer: NodeJS.Timeout | null = null;

function getMaxInFlightLogs(): number | null {
    const raw = process.env.MAX_IN_FLIGHT_LOGS;

    if (raw === undefined) {
        return null;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value <= 0) {
        return DEFAULT_MAX_IN_FLIGHT_LOGS;
    }

    return value;
}

function flush(): void {
    if (timer !== null) {
        clearTimeout(timer);
        timer = null;
    }

    if (pending.length === 0) {
        return;
    }

    const batch = pending;

    pending = [];
    pendingLogCount = 0;

    const mergedLogs = batch.flatMap(
        (request) => request.logs
    );

    insertLogs(mergedLogs)
        .then(() => {
            inFlightLogCount -= mergedLogs.length;

            for (const request of batch) {
                request.resolve();
            }
        })
        .catch((error: unknown) => {
            inFlightLogCount -= mergedLogs.length;

            for (const request of batch) {
                request.reject(error);
            }
        });
}

export function coalescedInsertLogs(
    logs: ValidLog[]
): Promise<void> {
    const maxInFlightLogs = getMaxInFlightLogs();

    if (
        maxInFlightLogs !== null &&
        inFlightLogCount + logs.length > maxInFlightLogs
    ) {
        return Promise.reject(
            new BackpressureError()
        );
    }

    inFlightLogCount += logs.length;

    return new Promise((resolve, reject) => {
        pending.push({
            logs,
            resolve,
            reject
        });

        pendingLogCount += logs.length;

        if (pendingLogCount >= MAX_BATCH_ENTRIES) {
            flush();
            return;
        }

        if (timer === null) {
            timer = setTimeout(
                flush,
                COALESCE_WINDOW_MS
            );
        }
    });
}