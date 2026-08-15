import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./pool.js";

export async function runMigrations() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id BIGSERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

    const migrationsDir = path.join(
        process.cwd(),
        "src",
        "db",
        "migrations"
    );

    const files = (await readdir(migrationsDir))
        .filter((file) => file.endsWith(".sql"))
        .sort();

    for (const file of files) {
        const alreadyApplied = await pool.query(
            "SELECT 1 FROM migrations WHERE name = $1",
            [file]
        );

        if (alreadyApplied.rowCount && alreadyApplied.rowCount > 0) {
            continue;
        }

        const sql = await readFile(
            path.join(migrationsDir, file),
            "utf8"
        );

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            await client.query(sql);

            await client.query(
                "INSERT INTO migrations (name) VALUES ($1)",
                [file]
            );

            await client.query("COMMIT");

            console.log(`Applied migration: ${file}`);
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }
}