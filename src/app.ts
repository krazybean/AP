import Fastify from "fastify";

import { registerRoutes } from "./routes.js";
import { requestBodyLimit } from "./http-config.js";

const app = Fastify({ trustProxy: process.env.VERCEL === "1", logger: { redact: ["req.headers.authorization", "req.headers.x-ap-access-token", "req.headers.x-ap-downstream-secret", "req.headers.x-app-license", "req.headers.cookie", "req.headers.set-cookie"] }, bodyLimit: requestBodyLimit() });
registerRoutes(app);

if (process.env.VERCEL === "1") {
  void app.listen({ port: 3000 }).catch((error) => {
    app.log.error(error, "AP failed to start");
    process.exitCode = 1;
  });
}

export default app;
