import Fastify from "fastify";
import { pool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { logsRoutes } from "./routes/logs.js";

const app = Fastify({
    logger: true
});

app.get("/health", async (_request, reply) => {
    try {
        await pool.query("SELECT 1");  // //Database health check

        return {
            status: "ok"
        };
    } catch {
        return reply.status(503).send({
            status: "unavailable"
        });
    }
});

async function start() {
    try {
        await pool.query("SELECT 1");

        console.log("Database connected successfully.");

        await runMigrations();

        console.log("Database migrations applied.");

        await app.register(logsRoutes);   //خذ الـ routes الموجودة داخل logsRoutes واعرف عنها.

        await app.listen({
            port: 8080,
            host: "0.0.0.0"
        });
    } catch (error) {
        app.log.error(error);
        process.exit(1);
    }
}

start();