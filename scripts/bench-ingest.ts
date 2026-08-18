const API_URL = "http://localhost:8080/logs";

const TOTAL_LOGS = 500;
const BATCH_SIZE = 500;
const CONCURRENCY = 1;

let nextBatch = 0;
let accepted = 0;
let rejected = 0;
let failedRequests = 0;

const totalBatches = Math.ceil(TOTAL_LOGS / BATCH_SIZE);

function createBatch(batchNumber: number) {
    const remaining = TOTAL_LOGS - batchNumber * BATCH_SIZE;
    const size = Math.min(BATCH_SIZE, remaining);

    const logs = Array.from({ length: size }, (_, index) => ({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "benchmark-service",
        message: `benchmark log ${batchNumber}-${index}`,
        attributes: {
            region: "local",
            worker: batchNumber % CONCURRENCY,
            benchmark: true
        }
    }));

    return { logs };
}

async function worker() {
    while (true) {
        const batchNumber = nextBatch++;

        if (batchNumber >= totalBatches) {
            return;
        }

        const body = createBatch(batchNumber);

        try {
            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "content-type": "application/json"
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                failedRequests++;

                const errorBody = await response.text();

                console.error(
                    `Request ${batchNumber} failed with HTTP ${response.status}: ${errorBody}`
                );

                continue;
            }

            const result = await response.json() as {
                accepted: number;
                rejected: Array<unknown>;
            };

            accepted += result.accepted;
            rejected += result.rejected.length;
        } catch (error) {
            failedRequests++;
            console.error(`Request ${batchNumber} failed:`, error);
        }
    }
}

async function main() {
    console.log("Starting ingestion benchmark...");
    console.log(`Total logs:   ${TOTAL_LOGS}`);
    console.log(`Batch size:   ${BATCH_SIZE}`);
    console.log(`Concurrency:  ${CONCURRENCY}`);
    console.log();

    const start = performance.now();

    await Promise.all(
        Array.from({ length: CONCURRENCY }, () => worker())
    );

    const end = performance.now();

    const seconds = (end - start) / 1000;
    const logsPerSecond = accepted / seconds;

    console.log();
    console.log("===== RESULTS =====");
    console.log(`Time:            ${seconds.toFixed(2)} sec`);
    console.log(`Accepted:        ${accepted}`);
    console.log(`Rejected:        ${rejected}`);
    console.log(`Failed requests: ${failedRequests}`);
    console.log(`Throughput:      ${Math.round(logsPerSecond)} logs/sec`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});