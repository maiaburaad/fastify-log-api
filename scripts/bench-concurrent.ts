const INGEST_URL = "http://localhost:8080/logs";
const AGGREGATE_URL =
    "http://localhost:8080/logs/aggregate" +
    "?since=2026-08-18T03:00:00Z" +
    "&until=2026-08-18T04:00:00Z" +
    "&bucket=1m";

const TOTAL_LOGS = 300_000;
const BATCH_SIZE = 500;
const CONCURRENCY = 8;

let nextBatch = 0;
let accepted = 0;
let rejected = 0;
let failedRequests = 0;

const aggregateLatencies: number[] = [];
let aggregateFailures = 0;

const totalBatches = Math.ceil(TOTAL_LOGS / BATCH_SIZE);

function createBatch(batchNumber: number) {
    const remaining = TOTAL_LOGS - batchNumber * BATCH_SIZE;
    const size = Math.min(BATCH_SIZE, remaining);

    const logs = Array.from({ length: size }, (_, index) => ({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "benchmark-service",
        message: `concurrent benchmark ${batchNumber}-${index}`,
        attributes: {
            region: "local",
            worker: batchNumber % CONCURRENCY,
            benchmark: true
        }
    }));

    return { logs };
}

async function ingestionWorker() {
    while (true) {
        const batchNumber = nextBatch++;

        if (batchNumber >= totalBatches) {
            return;
        }

        const response = await fetch(INGEST_URL, {
            method: "POST",
            headers: {
                "content-type": "application/json"
            },
            body: JSON.stringify(createBatch(batchNumber))
        });

        if (!response.ok) {
            failedRequests++;
            continue;
        }

        const result = await response.json() as {
            accepted: number;
            rejected: Array<unknown>;
        };

        accepted += result.accepted;
        rejected += result.rejected.length;
    }
}

async function runAggregation(stop: { value: boolean }) {
    while (!stop.value) {
        const start = performance.now();

        try {
            const response = await fetch(AGGREGATE_URL);

            const end = performance.now();

            if (response.ok) {
                aggregateLatencies.push(end - start);
            } else {
                aggregateFailures++;
            }
        } catch {
            aggregateFailures++;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);

    const index = Math.min(
        sorted.length - 1,
        Math.ceil((p / 100) * sorted.length) - 1
    );

    return sorted[index] ?? 0;
}

async function main() {
    console.log("Starting concurrent benchmark...");
    console.log(`Total logs:   ${TOTAL_LOGS}`);
    console.log(`Batch size:   ${BATCH_SIZE}`);
    console.log(`Concurrency:  ${CONCURRENCY}`);
    console.log();

    const stopAggregation = { value: false };

    const aggregatePromise = runAggregation(stopAggregation);

    const start = performance.now();

    await Promise.all(
        Array.from({ length: CONCURRENCY }, () => ingestionWorker())
    );

    const end = performance.now();

    stopAggregation.value = true;

    await aggregatePromise;

    const seconds = (end - start) / 1000;
    const throughput = accepted / seconds;

    const average =
        aggregateLatencies.length === 0
            ? 0
            : aggregateLatencies.reduce((sum, value) => sum + value, 0) /
            aggregateLatencies.length;

    console.log();
    console.log("===== INGESTION =====");
    console.log(`Time:            ${seconds.toFixed(2)} sec`);
    console.log(`Accepted:        ${accepted}`);
    console.log(`Rejected:        ${rejected}`);
    console.log(`Failed requests: ${failedRequests}`);
    console.log(`Throughput:      ${Math.round(throughput)} logs/sec`);

    console.log();
    console.log("===== AGGREGATION =====");
    console.log(`Requests:        ${aggregateLatencies.length}`);
    console.log(`Failures:        ${aggregateFailures}`);
    console.log(`Average:         ${average.toFixed(2)} ms`);
    console.log(`p50:             ${percentile(aggregateLatencies, 50).toFixed(2)} ms`);
    console.log(`p95:             ${percentile(aggregateLatencies, 95).toFixed(2)} ms`);
    console.log(`Max:             ${Math.max(0, ...aggregateLatencies).toFixed(2)} ms`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});