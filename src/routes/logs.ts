import type { FastifyInstance } from "fastify";
import { validateLogEntry } from "../schemas/log.js";
import { insertLogs } from "../db/logs.js";

export async function logsRoutes(app: FastifyInstance) {
    app.post("/logs", async (request, reply) => {
        const body = request.body;

        if (
            typeof body !== "object" ||
            body === null ||
            Array.isArray(body) ||
            !("logs" in body) ||
            !Array.isArray(body.logs)
        ) {
            return reply.status(400).send({
                error: "request body must contain a logs array"  //Return 400 when top-level structure is invalid.
            });
        }

        const accepted = [];
        const rejected = [];

        for (let index = 0; index < body.logs.length; index++) {
            const result = validateLogEntry(body.logs[index]);

            if (result.valid) {
                accepted.push(result.log);
            } else {
                rejected.push({
                    index,
                    reason: result.reason
                });
            }
        }

        if (accepted.length === 0) {
            return reply.status(400).send({
                accepted: 0,
                rejected
            });
        }

        await insertLogs(accepted);

        return reply.status(200).send({
            accepted: accepted.length,
            rejected
        });
    });
}