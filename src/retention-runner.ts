import { deleteExpiredLogs } from "./db/retention.js";

const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

export function startRetentionJob(): NodeJS.Timeout {
    const runCleanup = async () => {
        try {
            const deleted = await deleteExpiredLogs();

            if (deleted > 0) {
                console.log(`Retention cleanup deleted ${deleted} expired logs.`);
            }
        } catch (error) {
            console.error("Retention cleanup failed:", error);
        }
    };

    void runCleanup();

    return setInterval(() => {
        void runCleanup();
    }, RETENTION_INTERVAL_MS);
}