import Fastify from "fastify";

import type { Broker } from "../src/broker.js";
import { requestBodyLimit } from "../src/http-config.js";
import { registerRoutes } from "../src/routes.js";

export function buildTestApp(broker?: Broker) {
  const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.headers.x-ap-access-token", "req.headers.x-ap-downstream-secret", "req.headers.x-app-license", "req.headers.cookie", "req.headers.set-cookie"] }, bodyLimit: requestBodyLimit() });
  registerRoutes(app, broker);
  return app;
}
