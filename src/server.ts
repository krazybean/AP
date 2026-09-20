import Fastify from "fastify";

import { registerRoutes } from "./routes.js";
import { renderStartupBanner } from "./startup-banner.js";

const app = Fastify({ logger: true });
registerRoutes(app);

const port = Number(process.env.PORT ?? 4117);
const host = process.env.HOST ?? "0.0.0.0";

renderStartupBanner({
  apVersion: "0.1.0",
  appVersion: "1.0.0",
  environment: process.env.NODE_ENV ?? "development",
  host,
  port,
});

app.listen({ port, host });
