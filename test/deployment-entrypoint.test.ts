import assert from "node:assert/strict";
import { test } from "node:test";

test("Vercel entrypoint exposes the AP routes without self-starting in smoke mode", async () => {
  const previousSmoke = process.env.AP_ENTRYPOINT_SMOKE;
  process.env.AP_ENTRYPOINT_SMOKE = "1";
  const { default: app } = await import("../src/app.js");

  try {
    await app.ready();
    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
  } finally {
    await app.close();
    if (previousSmoke === undefined) delete process.env.AP_ENTRYPOINT_SMOKE;
    else process.env.AP_ENTRYPOINT_SMOKE = previousSmoke;
  }
});
