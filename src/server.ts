import Fastify from "fastify";

import { registerRoutes } from "./routes.js";
import { renderStartupBanner } from "./startup-banner.js";
import { requestBodyLimit } from "./http-config.js";

const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.headers.x-ap-access-token", "req.headers.x-ap-downstream-secret", "req.headers.x-app-license", "req.headers.cookie", "req.headers.set-cookie"] }, bodyLimit: requestBodyLimit() });
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

void app.listen({ port, host }).catch((error) => {
  app.log.error(error, "AP failed to start");
  process.exitCode = 1;
});
