import assert from "node:assert/strict";
import { test } from "node:test";

import { BrokerCapacityError, type Broker } from "../src/broker.js";
import { ChannelBroker } from "../src/channel-broker.js";
import { buildTestApp } from "./build-test-app.js";

const validId = "c0a80101-0000-4000-8000-000000000001";

function stubBroker(overrides: Partial<Broker> = {}) {
  let calls = 0;
  const broker = {
    type: "memory" as const,
    health: async () => {},
    metrics: () => ({ queuedRequests: 0, inFlightRequests: 0 }),
    createChannel: async () => ({ id: validId, secret: "secret" }),
    hasChannel: async () => true,
    dispatch: async (_id: string, request: { headers: Record<string, string | string[] | undefined> }) => {
      calls++;
      (broker as { lastHeaders?: typeof request.headers }).lastHeaders = request.headers;
      return { statusCode: 200, headers: {}, body: "ok" };
    },
    next: async () => null,
    respond: async () => {},
    authenticateClient: async () => {},
    createClientCredential: async () => ({ id: "credential", token: "token", createdAt: Date.now() }),
    revokeClientCredential: async () => {},
    ...overrides,
  } as Broker & { calls: number; lastHeaders?: Record<string, string | string[] | undefined> };
  Object.defineProperty(broker, "calls", { get: () => calls });
  return broker;
}

test("malformed channel and request UUIDs return 404 before broker access", async () => {
  const broker = stubBroker();
  const app = buildTestApp(broker);
  for (const url of ["/c/not-a-uuid", "/channels/not-a-uuid/next", "/channels/not-a-uuid/responses/not-a-uuid", `/channels/${validId}/responses/nope`]) {
    assert.equal((await app.inject({ method: url.includes("responses") ? "POST" : "GET", url, payload: {} })).statusCode, 404);
  }
  assert.equal(broker.calls, 0);
  await app.close();
});

test("well-formed but nonexistent channel IDs still return 404", async () => {
  const app = buildTestApp(new ChannelBroker());
  assert.equal((await app.inject({ method: "GET", url: `/c/${validId}` })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: `/channels/${validId}/next` })).statusCode, 404);
  await app.close();
});

test("channel capacity exhaustion returns a bounded retry response", async () => {
  const broker = stubBroker({ dispatch: async () => { throw new BrokerCapacityError(); } });
  const app = buildTestApp(broker);
  const response = await app.inject({ method: "GET", url: `/c/${validId}` });
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers["retry-after"], "1");
  assert.deepEqual(response.json(), { error: "channel_capacity_exceeded" });
  await app.close();
});

test("proxy strips forwarding and hop-by-hop headers, including Connection nominations", async () => {
  const broker = stubBroker();
  const app = buildTestApp(broker);
  const response = await app.inject({
    method: "GET", url: `/c/${validId}`,
    headers: {
      connection: "keep-alive, x-internal-hop", "keep-alive": "timeout=5", "x-internal-hop": "bad",
      "transfer-encoding": "chunked", "proxy-authorization": "bad", forwarded: "for=attacker",
      "content-length": "0",
      "x-forwarded-for": "attacker", "x-forwarded-host": "attacker", "x-forwarded-proto": "http",
      authorization: "Bearer app", accept: "application/json", "x-app-trace": "trace",
    },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(broker.lastHeaders, {
    authorization: "Bearer app", accept: "application/json", "x-app-trace": "trace",
    "user-agent": "lightMyRequest",
  });
  await app.close();
});

test("proxy strips unsafe downstream response headers while preserving safe ones", async () => {
  const broker = stubBroker({ dispatch: async () => ({
    statusCode: 201,
    headers: { "set-cookie": "session=bad", connection: "x-secret", "x-secret": "bad", "transfer-encoding": "chunked", "content-type": "text/plain", "x-app-result": "ok" },
    body: "ok",
  }) });
  const app = buildTestApp(broker);
  const response = await app.inject({ method: "GET", url: `/c/${validId}` });
  assert.equal(response.statusCode, 201);
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(response.headers["x-secret"], undefined);
  assert.equal(response.headers["transfer-encoding"], undefined);
  assert.equal(response.headers["content-type"], "text/plain");
  assert.equal(response.headers["x-app-result"], "ok");
  assert.equal(response.body, "ok");
  await app.close();
});

test("production metrics are disabled without a token and require the configured bearer token", async () => {
  const oldEnv = { nodeEnv: process.env.NODE_ENV, token: process.env.AP_METRICS_TOKEN };
  process.env.NODE_ENV = "production";
  delete process.env.AP_METRICS_TOKEN;
  const app = buildTestApp();
  assert.equal((await app.inject({ method: "GET", url: "/metrics" })).statusCode, 404);
  process.env.AP_METRICS_TOKEN = "secret";
  assert.equal((await app.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer wrong" } })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer secret" } })).statusCode, 200);
  await app.close();
  if (oldEnv.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv.nodeEnv;
  if (oldEnv.token === undefined) delete process.env.AP_METRICS_TOKEN; else process.env.AP_METRICS_TOKEN = oldEnv.token;
});

test("health caches broker checks briefly, including failure results", async () => {
  let checks = 0;
  const app = buildTestApp(stubBroker({ health: async () => { checks++; throw new Error("down"); } }));
  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 503);
  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 503);
  assert.equal(checks, 1);
  await app.close();
});

test("request body limit is configurable and oversized input is rejected", async () => {
  const prior = process.env.AP_REQUEST_BODY_LIMIT_BYTES;
  process.env.AP_REQUEST_BODY_LIMIT_BYTES = "16";
  const app = buildTestApp();
  const response = await app.inject({ method: "POST", url: "/channels", payload: { value: "this payload exceeds sixteen bytes" } });
  assert.equal(response.statusCode, 413);
  await app.close();
  if (prior === undefined) delete process.env.AP_REQUEST_BODY_LIMIT_BYTES;
  else process.env.AP_REQUEST_BODY_LIMIT_BYTES = prior;
});
