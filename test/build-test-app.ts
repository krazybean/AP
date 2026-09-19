import Fastify from "fastify";

import { registerRoutes } from "../src/routes.js";

export function buildTestApp() {
  const app = Fastify({ logger: true });
  registerRoutes(app);
  return app;
}
