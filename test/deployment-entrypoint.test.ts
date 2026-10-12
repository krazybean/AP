import assert from "node:assert/strict";
import { test } from "node:test";

test("Vercel entrypoint exposes the AP routes", async () => {
  const { default: app } = await import("../src/app.js");

  try {
    await app.ready();
    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
  } finally {
    await app.close();
  }
});
