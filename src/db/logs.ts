import type { ValidLog } from "../schemas/log.js";
import { pool } from "./pool.js";

export async function insertLogs(logs: ValidLog[]): Promise<void> {
    if (logs.length === 0) {
        return;
    }

    const values: unknown[] = [];
    const placeholders: string[] = [];

    logs.forEach((log, index) => {
        const base = index * 5;

        placeholders.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
        );

        values.push(
            log.timestamp,
            log.level,
            log.service,
            log.message,
            JSON.stringify(log.attributes)
        );
    });

    const sql = `
    INSERT INTO logs (
      timestamp,
      level,
      service,
      message,
      attributes
    )
    VALUES ${placeholders.join(", ")}
  `;

    await pool.query(sql, values);
}