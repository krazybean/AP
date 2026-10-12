import assert from "node:assert/strict";
import { test } from "node:test";

test("production entrypoint starts Fastify and serves AP routes", async () => {
  const previousSmoke = process.env.AP_ENTRYPOINT_SMOKE;
  process.env.AP_ENTRYPOINT_SMOKE = "1";
  const entrypoint = process.env.AP_ENTRYPOINT_ARTIFACT === "dist" ? "../dist/app.js" : "../src/app.js";
  const { default: app } = await import(entrypoint);

  try {
    await app.ready();

    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);

    const channel = await app.inject({ method: "GET", url: "/c/not-a-channel" });
    assert.equal(channel.statusCode, 404);
  } finally {
    await app.close();
    if (previousSmoke === undefined) delete process.env.AP_ENTRYPOINT_SMOKE;
    else process.env.AP_ENTRYPOINT_SMOKE = previousSmoke;
  }
});
