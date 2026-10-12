import Fastify from "fastify";

import { registerRoutes } from "./routes.js";
import { requestBodyLimit } from "./http-config.js";

const app = Fastify({ trustProxy: process.env.VERCEL === "1", logger: { redact: ["req.headers.authorization", "req.headers.x-ap-access-token", "req.headers.x-ap-downstream-secret", "req.headers.x-app-license", "req.headers.cookie", "req.headers.set-cookie"] }, bodyLimit: requestBodyLimit() });
registerRoutes(app);

if (process.env.VERCEL === "1") {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  void app.listen({ port, host }).catch((error) => {
    app.log.error(error, "AP failed to start");
  });
}

export default app;
