import Fastify from "fastify";

import type { Broker } from "../src/broker.js";
import { requestBodyLimit } from "../src/http-config.js";
import { registerRoutes } from "../src/routes.js";

export function buildTestApp(broker?: Broker) {
  const app = Fastify({ logger: true, bodyLimit: requestBodyLimit() });
  registerRoutes(app, broker);
  return app;
}
