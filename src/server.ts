import "./app.js";
import { renderStartupBanner } from "./startup-banner.js";

const port = Number(process.env.PORT ?? 4117);
const host = process.env.HOST ?? "0.0.0.0";

renderStartupBanner({
  apVersion: "0.1.0",
  appVersion: "1.0.0",
  environment: process.env.NODE_ENV ?? "development",
  host,
  port,
});
