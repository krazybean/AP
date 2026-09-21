import Fastify from "fastify";

import type { Broker } from "../src/broker.js";
import { registerRoutes } from "../src/routes.js";

export function buildTestApp(broker?: Broker) {
  const app = Fastify({ logger: true });
  registerRoutes(app, broker);
  return app;
}
