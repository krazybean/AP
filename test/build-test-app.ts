import Fastify from "fastify";

import type { Broker } from "../src/broker.js";
import { requestBodyLimit } from "../src/http-config.js";
import { registerRoutes, type RouteOptions } from "../src/routes.js";
import { testBroker } from "./test-broker.js";

export function buildTestApp(broker: Broker = testBroker(), options: RouteOptions = {}) {
  const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.headers.x-ap-access-token", "req.headers.x-ap-downstream-secret", "req.headers.x-app-license", "req.headers.x-ap-key", "req.headers.cookie", "req.headers.set-cookie"] }, bodyLimit: requestBodyLimit() });
  registerRoutes(app, broker, options);
  return app;
}
