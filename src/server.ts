import { createApp } from "./fastify-app.js";
import { renderStartupBanner } from "./startup-banner.js";

const app = createApp();

const port = Number(process.env.PORT ?? 4117);
const host = process.env.HOST ?? "0.0.0.0";

renderStartupBanner({
  apVersion: "1.1.0",
  appVersion: "1.0.0",
  environment: process.env.NODE_ENV ?? "development",
  host,
  port,
});

void app.listen({ port, host }).catch((error) => {
  app.log.error(error, "AP failed to start");
  process.exitCode = 1;
});
