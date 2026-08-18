import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "postgres",
    password: process.env.DB_PASSWORD ?? "postgres",
    database: process.env.DB_NAME ?? "logs_db",
    max: Number(process.env.DB_POOL_MAX ?? 10)
});