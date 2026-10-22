import Fastify, { type FastifyServerOptions } from "fastify";

import { registerRoutes } from "./routes.js";
import { requestBodyLimit } from "./http-config.js";

export function appOptions(): FastifyServerOptions {
  return { trustProxy: process.env.VERCEL === "1", logger: { redact: ["req.headers.authorization", "req.headers.x-ap-access-token", "req.headers.x-ap-downstream-secret", "req.headers.x-app-license", "req.headers.x-ap-key", "req.headers.cookie", "req.headers.set-cookie"] }, bodyLimit: requestBodyLimit() };
}

export function createApp() {
  const app = Fastify(appOptions());
  registerRoutes(app);
  return app;
}
