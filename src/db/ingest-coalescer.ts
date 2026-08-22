import type { ValidLog } from "../schemas/log.js";
import { insertLogs } from "./insert-logs.js";

const COALESCE_WINDOW_MS = 10;
const MAX_BATCH_ENTRIES = 10_000;

interface PendingRequest {
    logs: ValidLog[];
    resolve: () => void;
    reject: (error: unknown) => void;
}

let pending: PendingRequest[] = [];
let pendingLogCount = 0;
let timer: NodeJS.Timeout | null = null;

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
            for (const request of batch) {
                request.resolve();
            }
        })
        .catch((error: unknown) => {
            for (const request of batch) {
                request.reject(error);
            }
        });
}

export function coalescedInsertLogs(
    logs: ValidLog[]
): Promise<void> {
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