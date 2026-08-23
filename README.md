<div align="center">

# Fastify Log API

### High-performance structured log ingestion, querying, and aggregation under strict resource limits

**Best observed local run: 94.9 / 100**  
**Best archived benchmark report: 94.6 / 100**  
**Ubuntu reproduction: 94.5 / 100**

**14,999 logs/s · 0.0% errors · 15/15 correctness · 20/20 reliability**

[![CI](https://github.com/maiaburaad/fastify-log-api/actions/workflows/ci.yml/badge.svg)](https://github.com/maiaburaad/fastify-log-api/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

</div>

---

## Why This Project Is Interesting

This is not only an API implementation. It is a performance-engineering exercise built around a strict contract and strict infrastructure limits.

The service had to:

- ingest large batches of structured logs;
- keep PostgreSQL as the source of truth;
- support deterministic cursor pagination;
- filter by service, level, time range, message text, and arbitrary JSONB attributes;
- answer grouped time-bucketed aggregations;
- remain correct under load;
- stay within **0.5 CPU / 256 MB** for the application and **1 CPU / 1 GB** for PostgreSQL;
- and survive load, stress, spike, and breakpoint scenarios.

The final design came from repeated measurement:

> **implement → benchmark → identify the bottleneck → isolate an experiment → benchmark again → keep or revert**

That process included successful optimizations, regressions, discarded ideas, custom testing scripts, and multiple benchmark environments.

---

## Performance at a Glance

| Metric | Best archived Windows report | Ubuntu 26.04 LTS / WSL2 |
|---|---:|---:|
| **Total score** | **94.6 / 100** | **94.5 / 100** |
| Correctness | **15.0 / 15** | **15.0 / 15** |
| Performance | **45.0 / 50** | **45.0 / 50** |
| Queries | **14.6 / 15** | **14.5 / 15** |
| Reliability | **20.0 / 20** | **20.0 / 20** |
| Load throughput | **14,999 logs/s** | **14,999 logs/s** |
| Error rate | **0.0%** | **0.0%** |
| Request p95 | **~51 ms** | **~54 ms** |
| Aggregate p95 | **~23 ms** | **~28 ms** |
| Consistency | **4 / 4 scenarios** | **4 / 4 scenarios** |
| Machine-speed factor | **0.476x reference** | **0.41x reference** |

During tuning, two local CLI runs also reached **94.9 / 100**, with approximately:

```text
14,999 logs/s
0.0% errors
27–28 ms request p95
4 ms aggregate p95
```

Those `94.9` runs were observed from the CLI during development but were not preserved as a separate committed JSON report. The repository therefore keeps the **94.6 archived report** as the primary stored benchmark artifact, while the later Ubuntu run independently reproduced **94.5**.

<p align="center">
  <img src="docs/performance-evolution.png" alt="Performance evolution" width="820">
</p>

### Archived milestone comparison

Git history preserves an earlier `64.2 / 100` benchmark snapshot and a later optimized `94.6 / 100` snapshot.

| Archived milestone | Score | Machine speed | Throughput | Request p95 | Aggregate p95 | Errors |
|---|---:|---:|---:|---:|---:|---:|
| Early optimization snapshot | **64.2** | **0.200x** | **6,158/s** | **2,769 ms** | **1,569 ms** | **0%** |
| Optimized rollup snapshot | **94.6** | **0.476x** | **14,999/s** | **51 ms** | **23 ms** | **0%** |

<p align="center">
  <img src="docs/latency-comparison.png" alt="Archived latency comparison" width="760">
</p>

These snapshots were recorded on machines with different benchmark speed factors, so they are shown as **project milestones**, not as a controlled single-variable A/B test.

---

## Resource Envelope

| Component | Limit |
|---|---:|
| Fastify application | **0.5 CPU / 256 MB RAM** |
| PostgreSQL | **1 CPU / 1 GB RAM** |
| Benchmark generator | **4 CPUs / 1 GB RAM** |
| Seed dataset | **1,000,000 rows** |

The benchmark also reported generator limitations in stress, spike, and breakpoint on some runs. Those scenarios therefore understate the offered workload and should not be read as exact service saturation points.

---

# Architecture

```mermaid
flowchart TB
    Client["Client / Load Generator"]

    subgraph API["Fastify API :8080"]
        Post["POST /logs"]
        Get["GET /logs"]
        Agg["GET /logs/aggregate"]
        Health["GET /health"]

        Validate["Per-entry validation"]
        Rate["Optional rate limiter"]
        Pressure["Optional backpressure"]
        Coal["10 ms request coalescer"]
    end

    subgraph PG["PostgreSQL — Source of Truth"]
        Pool["Reusable connection pool"]
        Logs[("logs\nraw events")]
        Rollup[("log_rollups\n5-second sharded counters")]
    end

    Retention["Retention worker"]

    Client --> Post --> Rate --> Validate --> Pressure --> Coal --> Pool
    Client --> Get --> Pool
    Client --> Agg --> Pool
    Client --> Health --> Pool

    Pool --> Logs
    Pool --> Rollup

    Retention --> Pool
    Retention --> Logs
    Retention --> Rollup
```

The raw `logs` table remains authoritative. `log_rollups` is a derived acceleration structure used to make common aggregation queries cheap.

---

# Data Model

```mermaid
erDiagram
    LOGS {
        BIGSERIAL id PK
        TIMESTAMPTZ timestamp
        TEXT level
        TEXT service
        TEXT message
        JSONB attributes
    }

    LOG_ROLLUPS {
        TIMESTAMPTZ minute_start PK
        TEXT service PK
        TEXT level PK
        SMALLINT shard PK
        BIGINT count
    }

    LOGS ||..o{ LOG_ROLLUPS : "summarized into"
```

`minute_start` is a historical column name. In the final design it represents the beginning of a **5-second rollup interval**.

## Why JSONB?

Log attributes are producer-defined and schema-flexible. One service may send `region`, another `worker`, another `request_id`. JSONB allows those keys to coexist without a database migration for each new attribute.

Example:

```json
{
  "region": "local",
  "worker": 2,
  "benchmark": true
}
```

`attr.<key>` filters compile to PostgreSQL JSONB extraction using `attributes ->> key`.

---

# Indexing Strategy

The final schema uses targeted B-tree indexes plus a lightweight BRIN index for time-oriented data.

| Index | Type | Supports |
|---|---|---|
| `(timestamp DESC, id DESC)` | B-tree | ordering, cursor pagination, time-based reads |
| `(service, timestamp DESC, id DESC)` | B-tree | service-filtered chronological queries |
| `(level, timestamp DESC, id DESC)` | B-tree | level-filtered chronological queries |
| `timestamp` | BRIN | large naturally time-ordered ranges with low index overhead |

There is **no GIN index** in the final schema.

The key principle was not “add indexes everywhere,” but “index the access patterns the API actually uses.”

---

# Write Path

```mermaid
sequenceDiagram
    autonumber
    participant A as Request A
    participant B as Request B
    participant API as Fastify
    participant C as Coalescer
    participant DB as PostgreSQL

    A->>API: POST /logs
    B->>API: POST /logs
    API->>API: Validate each entry
    API->>C: Accepted logs
    API->>C: Accepted logs

    Note over C: Flush after 10 ms<br/>or at 10,000 pending entries

    C->>DB: Multi-row INSERT
    DB->>DB: Compute 5-second counts
    DB->>DB: Upsert sharded rollups
    DB-->>C: Durable success

    C-->>API: Resolve participating requests
    API-->>A: accepted / rejected
    API-->>B: accepted / rejected
```

## Request coalescing

Concurrent requests are briefly collected before database work is issued.

```text
COALESCE_WINDOW_MS = 10
MAX_BATCH_ENTRIES = 10,000
```

This converts many small concurrent write operations into fewer, larger database operations.

## Multi-row INSERT

The final write path uses a parameterized multi-row `INSERT`, not `COPY`.

That choice was made from measurement, not assumption.

---

# The COPY Experiment

PostgreSQL `COPY` was explicitly tested because it is often the first recommendation for high-volume ingestion.

It did **not** win for this workload.

Selected local measurements during the experiment:

| Ingestion path | Approx. measured throughput | Decision |
|---|---:|---|
| Multi-row INSERT baseline | ~10.4k logs/s | Continue tuning |
| Multi-row INSERT, larger batch | ~10.5k logs/s | Small gain |
| COPY CSV | ~5.2k logs/s | Rejected |
| COPY CSV with logging disabled | ~5.3k logs/s | Still rejected |
| Multi-row INSERT with logging disabled | ~18.2k logs/s | Strong local result |
| COPY TEXT + transactional rollup work | ~6.2k logs/s | Rejected |
| Multi-row INSERT + rollup work | ~13.1k logs/s | Better fit |

`COPY` is an excellent bulk-loading primitive in many workloads, but this API is not a one-shot file importer. The write path also has validation, HTTP batching, rollup maintenance, transactional semantics, and concurrency behavior.

The experiment was therefore reverted instead of being kept merely because `COPY` is theoretically associated with bulk performance.

> **A famous optimization is still only a hypothesis until it survives your workload.**

---

# 16-Way Rollup Sharding

Without sharding, concurrent writers can repeatedly update the same logical rollup counter.

The final design adds a `shard` to the rollup primary key:

```text
(minute_start, service, level, shard)
```

Each ingestion flush chooses a shard in round-robin order:

```text
0 → 1 → 2 → ... → 15 → 0
```

```mermaid
flowchart LR
    W1["Write batch"] --> S0["shard 0"]
    W2["Write batch"] --> S1["shard 1"]
    W3["Write batch"] --> S2["shard 2"]
    W4["..."] --> S15["shard 15"]

    S0 --> Sum["SUM(count)"]
    S1 --> Sum
    S2 --> Sum
    S15 --> Sum

    Sum --> Logical["Logical bucket count"]
```

The write side spreads contention; the read side reconstructs the logical count with `SUM(count)`.

---

# Aggregation Strategy

The final aggregation design combines **5-second rollups** with direct raw-log reads for partial edges.

```mermaid
flowchart LR
    Since["since"] --> Left["Partial edge\nraw logs"]
    Left --> Middle["Aligned interior\n5-second rollups"]
    Middle --> Right["Partial edge\nraw logs"]
    Right --> Until["until"]

    Left --> Merge["UNION ALL + SUM"]
    Middle --> Merge
    Right --> Merge

    Merge --> Bucket["1m / 5m / 1h / 1d"]
```

Why not use rollups for every byte of the range?

Because `since` and `until` may fall in the middle of a 5-second interval. Taking the whole counter would over-count. The final design therefore uses raw rows only where exact boundaries require them.

When the query contains filters not represented in the rollup, such as:

```text
q
attr.<key>
```

aggregation falls back to the raw `logs` table.

---

# Performance Engineering Journey

The repository history records the architecture evolving in stages.

```mermaid
flowchart LR
    A["PostgreSQL + migrations"] --> B["Batch ingestion"]
    B --> C["Rollup aggregation"]
    C --> D["Ingestion / rollup tuning"]
    D --> E["BRIN experiment"]
    E --> F["Sharded counters"]
    F --> G["Pool tuning"]
    G --> H["Partial-edge optimization"]
    H --> I["5-second rollups"]
    I --> J["Request coalescing"]
    J --> K["Retention consistency"]
    K --> L["Rate limit + backpressure"]
    L --> M["CI + Linux reproduction"]
```

## Selected Git milestones

| Commit | Change |
|---|---|
| `311f331` | PostgreSQL setup and migrations |
| `5470c89` | Batch log ingestion |
| `7d54ceb` | Rollup aggregation and performance work |
| `f30eab4` | Aggregation optimization with rollups |
| `b576eda` | Log ingestion and rollup-update optimization |
| `fcda313` | BRIN timestamp-index experiment |
| `ba67edc` | Shard rollup counters |
| `b963ee4` | Increase / tune database pool size |
| `9be9061` | Optimize aggregate partial-edge handling |
| `7f903b5` | Rebuild rollups at 5-second granularity |
| `62da35e` | Coalesce concurrent ingestion requests |
| `2aa5fc8` | Keep rollups consistent during retention |
| `91efbbf` | Optional rate limiting and backpressure |
| `c666206` | CI build and smoke tests |
| `76e2fc0` | Migration cleanup / obsolete code removal |

---

# Experiments That Did Not Become the Final Design

Not every branch was meant to survive.

The repository contains isolated experiment/backup branches including:

```text
experiment-async-rollup
experiment-rollup-deltas
experiment-rollup-deltas-v2
experiment-post-94
experiment-rate-backpressure
backup-brin-version
backup-current-optimized
backup-old-version
```

## Async rollup experiment

An asynchronous rollup direction was explored, but the final architecture keeps raw insertion and rollup maintenance together in the ingestion database path.

The final choice favors straightforward consistency semantics: a successful write does not leave derived counters intentionally pending in a separate asynchronous pipeline.

## Rollup-delta experiments

Alternative rollup-update strategies were tested before the project converged on:

```text
5-second counters
+
16-way sharding
+
partial-edge raw reads
```

The experiment branches were retained rather than pretending every attempted optimization became part of the final system.

## Pool tuning

The database pool was tuned during performance work. More connections were not treated as automatically better; the final Docker configuration uses:

```text
DB_POOL_MAX=20
```

while the code fallback is `10`.

## BRIN

BRIN indexing was evaluated as part of the timestamp-range strategy and remains as a lightweight complement to the B-tree access paths.

It is not presented as a universal replacement for the composite B-tree indexes.

---

# Custom Benchmarking During Development

The project did not rely only on the final evaluator.

Custom scripts were written to test ingestion behavior quickly while changing batch size, concurrency, and implementation strategy.

## `scripts/bench-ingest.ts`

One version of the custom ingestion benchmark generated:

```text
TOTAL_LOGS = 300,000
BATCH_SIZE = 1,000
CONCURRENCY = 4
```

Each worker repeatedly sent:

```http
POST /logs
```

and tracked:

```text
accepted
rejected
failed requests
elapsed time
logs / second
```

Conceptually:

```mermaid
flowchart LR
    Generate["Generate 300k logs"] --> Batch["Batches of 1,000"]
    Batch --> W1["Worker 1"]
    Batch --> W2["Worker 2"]
    Batch --> W3["Worker 3"]
    Batch --> W4["Worker 4"]

    W1 --> API["POST /logs"]
    W2 --> API
    W3 --> API
    W4 --> API

    API --> Count["accepted / rejected / failed"]
    Count --> Result["Throughput = accepted / seconds"]
```

## Why custom scripts mattered

The custom benchmarks were useful for fast development feedback:

- compare ingestion strategies;
- change batch size;
- vary concurrency;
- catch failed requests;
- measure local logs/sec;
- verify whether an optimization was worth sending to the full benchmark.

They were **development tools**, not substitutes for the official workload. The final benchmark was still used for correctness, load/stress/spike/breakpoint behavior, aggregation latency, and reliability.

---

# When the Score Dropped

A lower local score did not always mean a code regression.

Selected runs:

| Run | Machine speed | Score | Throughput | Request p95 | Aggregate p95 |
|---|---:|---:|---:|---:|---:|
| Strong Windows run | ~0.48x | **94.9** | **14,999/s** | **27 ms** | **4 ms** |
| Slower-machine run | 0.38x | **89.0** | **14,999/s** | **415 ms** | **138 ms** |
| Optional-feature verification | 0.34x | **90.6** | **14,870/s** | **282 ms** | **125 ms** |
| Ubuntu reproduction | 0.41x | **94.5** | **14,999/s** | **54 ms** | **28 ms** |

The benchmark tool itself warned when the generator could not schedule every requested iteration.

This changed how performance results were interpreted:

> **score + machine speed + generator behavior + correctness + errors**  
> is more meaningful than score alone.

---

# API Reference

## POST `/logs`

Batch ingestion with per-entry validation.

```json
{
  "logs": [
    {
      "timestamp": "2026-08-23T10:00:00.000Z",
      "level": "info",
      "service": "checkout",
      "message": "payment accepted",
      "attributes": {
        "region": "local",
        "attempt": 1,
        "success": true
      }
    }
  ]
}
```

### Validation

| Field | Rule |
|---|---|
| `timestamp` | ISO-8601; no more than 5 minutes in the future |
| `level` | `debug`, `info`, `warn`, `error` |
| `service` | non-empty string |
| `message` | non-empty string |
| `attributes` | optional flat object of string, number, or boolean |

Valid entries may still be accepted when other entries in the same batch are rejected.

---

## GET `/logs`

Supported query parameters:

| Parameter | Purpose |
|---|---|
| `service` | exact service filter |
| `level` | exact level filter |
| `since` | inclusive lower timestamp bound |
| `until` | exclusive upper timestamp bound |
| `q` | case-insensitive substring search on `message` |
| `attr.<key>` | JSONB attribute filter |
| `limit` | default `100`, maximum `1000` |
| `cursor` | opaque cursor from the previous page |

Results are ordered with:

```sql
ORDER BY timestamp DESC, id DESC
```

Cursor comparisons use the same pair, producing deterministic pagination without deep `OFFSET` scans.

---

## GET `/logs/aggregate`

Required:

```text
since
until
bucket = 1m | 5m | 1h | 1d
```

Optional:

```text
service
level
q
attr.<key>
group_by = service | level
```

Buckets are returned in ascending time order.

---

## GET `/health`

The service checks PostgreSQL with:

```sql
SELECT 1
```

Startup performs:

```text
DB connectivity
    ↓
migrations
    ↓
retention scheduler
    ↓
route registration
    ↓
listen on 0.0.0.0:8080
```

A reachable `200 {"status":"ok"}` therefore indicates the application has completed startup and can still reach the database.

---

# Retention

Default policy:

```text
RETENTION_DAYS = 30
RETENTION_BATCH_SIZE = 5,000
RETENTION_INTERVAL = 1 hour
```

The job runs immediately on startup and then hourly.

```mermaid
flowchart TD
    Tick["Startup / hourly run"] --> Select["Select oldest expired IDs"]
    Select --> Delete["Delete up to 5,000 raw rows"]
    Delete --> More{"Deleted a full batch?"}
    More -- yes --> Select
    More -- no --> Repair["Repair affected rollup boundary"]
    Repair --> Done["Finish"]
```

The cleanup logic also keeps the derived rollups consistent with surviving raw data.

---

# Optional Rate Limiting and Backpressure

Both are **off by default** so they do not interfere with the standard benchmark workload.

## Rate limiting

Enable:

```text
RATE_LIMIT_REQUESTS_PER_SECOND=<positive integer>
```

When the one-second request window is exhausted:

```text
429 Too Many Requests
Retry-After: 1
```

## Backpressure

Enable:

```text
MAX_IN_FLIGHT_LOGS=<positive integer>
```

If accepting another batch would exceed the configured in-flight limit:

```text
503 Service Unavailable
Retry-After: 1
```

Backpressure was tested directly and in CI.

The service never responds `200` to a batch rejected by the backpressure gate.

---

# Migrations

```text
001_create_logs_table.sql
002_add_log_indexes.sql
003_create_log_rollups.sql
004_add_timestamp_brin.sql
005_shard_log_rollups.sql
006_rebuild_rollups_5s.sql
```

Migrations are:

- discovered from `src/db/migrations`;
- sorted by filename;
- recorded in a `migrations` table;
- executed transactionally;
- skipped when the same filename is already recorded.

The complete fresh-start path was also verified on Ubuntu from a new PostgreSQL volume.

---

# Continuous Integration

GitHub Actions automatically tests pushes and pull requests targeting `main`.

```mermaid
flowchart LR
    Change["Push / Pull Request"] --> Build["Typecheck + Build"]
    Change --> Default["Default smoke test"]
    Change --> Rate["Rate-limit test"]
    Change --> Pressure["Backpressure test"]

    Build --> CI["CI pass"]
    Default --> CI
    Rate --> CI
    Pressure --> CI
```

| CI job | Verification |
|---|---|
| Typecheck and Build | dependency install, `tsc --noEmit`, build |
| Default Mode Smoke Test | Docker startup, `/health`, POST, GET, aggregate |
| Rate Limiting Smoke Test | enabled mode produces `429` |
| Backpressure Smoke Test | enabled mode produces `503` + `Retry-After` |

---

# Quick Start

## Requirements

- Docker
- Docker Compose

```bash
git clone https://github.com/maiaburaad/fastify-log-api.git
cd fastify-log-api
docker compose up --build
```

Check readiness:

```bash
curl http://localhost:8080/health
```

Expected:

```json
{"status":"ok"}
```

Stop and remove the local database volume:

```bash
docker compose down -v
```

---

# Configuration

| Variable | Default / Compose value | Purpose |
|---|---|---|
| `DB_HOST` | `postgres` in Compose | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `postgres` | PostgreSQL user |
| `DB_PASSWORD` | `postgres` | PostgreSQL password |
| `DB_NAME` | `logs_db` | database name |
| `DB_POOL_MAX` | `20` in Compose / `10` fallback | max pool connections |
| `RETENTION_DAYS` | `30` | retention window |
| `RATE_LIMIT_REQUESTS_PER_SECOND` | unset | optional request limit |
| `MAX_IN_FLIGHT_LOGS` | unset | optional overload threshold |

Internal constants:

```text
COALESCE_WINDOW_MS = 10
MAX_BATCH_ENTRIES = 10,000
ROLLUP_SHARDS = 16
ROLLUP_INTERVAL = 5 seconds
RETENTION_BATCH_SIZE = 5,000
RETENTION_INTERVAL = 1 hour
```

---

# Benchmark Reproduction

Official CLI used during final local measurements:

```bash
npx --yes github:Ahmad-Abbas-Foothill/logs-benchmark-cli \
  --compose ./docker-compose.yml \
  --full \
  --seed 6122026 \
  --runner docker \
  --json benchmark-report.json \
  --generator-cpus 4
```

## Archived Windows report

```text
Correctness    15.0 / 15
Performance    45.0 / 50
Queries        14.6 / 15
Reliability    20.0 / 20

Total          94.6 / 100

Throughput     14,999 logs/s
Errors         0.0%
Request p95    ~51 ms
Aggregate p95  ~23 ms
Machine speed  0.476x reference
```

Raw score:

```text
94.58218888888888
```

## Ubuntu 26.04 LTS / WSL2 reproduction

```text
Correctness    15.0 / 15
Performance    45.0 / 50
Queries        14.5 / 15
Reliability    20.0 / 20

Total          94.5 / 100

Throughput     14,999 logs/s
Errors         0.0%
Request p95    ~54 ms
Aggregate p95  ~28 ms
Machine speed  0.41x reference
```

---

# Project Structure

```text
fastify-log-api/
├── .github/
│   └── workflows/
│       └── ci.yml
├── scripts/
│   ├── bench-concurrent.ts
│   └── bench-ingest.ts
├── src/
│   ├── db/
│   │   ├── migrations/
│   │   │   ├── 001_create_logs_table.sql
│   │   │   ├── 002_add_log_indexes.sql
│   │   │   ├── 003_create_log_rollups.sql
│   │   │   ├── 004_add_timestamp_brin.sql
│   │   │   ├── 005_shard_log_rollups.sql
│   │   │   └── 006_rebuild_rollups_5s.sql
│   │   ├── aggregate-logs.ts
│   │   ├── ingest-coalescer.ts
│   │   ├── insert-logs.ts
│   │   ├── migrate.ts
│   │   ├── pool.ts
│   │   ├── query-logs.ts
│   │   ├── retention.ts
│   │   └── test-connection.ts
│   ├── routes/
│   │   └── logs.ts
│   ├── schemas/
│   │   └── log.ts
│   ├── utils/
│   │   └── cursor.ts
│   ├── rate-limit.ts
│   ├── retention-runner.ts
│   └── server.ts
├── Dockerfile
├── docker-compose.yml
├── benchmark-report.json
├── package.json
└── tsconfig.json
```

---

# Engineering Takeaways

### Measure first

A theoretically faster approach can still be slower in the real request path. The `COPY` experiment was the clearest example.

### Optimize database work

The major improvements targeted round trips, hot-row contention, aggregation work, and bounded maintenance rather than micro-optimizing TypeScript.

### Preserve semantics

Correctness remained 15/15 while the architecture changed. Pagination stability, aggregate correctness, durable acknowledgement, and retention consistency were not traded away for speed.

### Keep failed experiments

Separate branches made it possible to test async rollups, rollup deltas, BRIN-related changes, pool changes, and post-94 experiments without endangering the stable branch.

### Interpret benchmarks with context

Machine speed and generator limitations materially changed local scores. A benchmark number without its environment is incomplete.

### Reproduce the result

The final stack was started from a fresh database and benchmarked again on Ubuntu/WSL2, producing a result close to the archived Windows report.

---

<div align="center">

## Built by measurement, not assumption.

**Fastify · TypeScript · PostgreSQL · Docker · GitHub Actions**

</div>
