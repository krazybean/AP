import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTestApp } from "./build-test-app.js";

test("GET /health reports AP is healthy", async () => {
  const app = buildTestApp();

  const response = await app.inject({
    method: "GET",
    url: "/health",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    service: "ap",
    broker: "ok",
    queuedRequests: 0,
    inFlightRequests: 0,
  });

  await app.close();
});

test("GET /health rejects when the broker is unavailable", async () => {
  const app = buildTestApp({
    health: async () => {
      throw new Error("REDIS_DOWN");
    },
  } as never);

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    status: "degraded",
    service: "ap",
    broker: "unavailable",
  });
  await app.close();
});

test("GET /metrics reports operational counters", async () => {
  const app = buildTestApp();

  const response = await app.inject({ method: "GET", url: "/metrics" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    channelsCreated: 0,
    channelRateLimits: 0,
    proxyRequests: 0,
    proxyResponses: 0,
    proxyTimeouts: 0,
    brokerErrors: 0,
    queuedRequests: 0,
    inFlightRequests: 0,
  });
  await app.close();
});
