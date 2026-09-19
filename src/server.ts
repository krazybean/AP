import Fastify from "fastify";

import { registerRoutes } from "./routes.js";

const app = Fastify({ logger: true });
registerRoutes(app);

const port = Number(process.env.PORT ?? 4117);
const host = process.env.HOST ?? "0.0.0.0";

app.listen({ port, host });
