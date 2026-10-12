// Vercel Fastify entrypoint (Vercel picks src/app.* first, and it must import fastify directly).
// Do not add a default export here: Vercel treats a default export as the
// request handler, and a Fastify instance is not one, so every request fails
// with INTERNAL_FUNCTION_INVOCATION_FAILED and no runtime logs.
import Fastify from "fastify";

import { appOptions } from "./fastify-app.js";
import { registerRoutes } from "./routes.js";

const app = Fastify(appOptions());
registerRoutes(app);

if (process.env.VERCEL === "1") {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  void app.listen({ port, host }).catch((error) => {
    app.log.error(error, "AP failed to start");
  });
}
