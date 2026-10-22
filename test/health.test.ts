import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTestApp } from "./build-test-app.js";
import { testBrokerType } from "./test-broker.js";

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
    brokerType: testBrokerType,
    queuedRequests: 0,
    inFlightRequests: 0,
    ...(testBrokerType === "redis" ? { redisCommands: 1, redisPollCommands: 0 } : {}),
  });

  await app.close();
});

test("GET /health rejects when the broker is unavailable", async () => {
  const app = buildTestApp({
    type: "redis",
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
    brokerType: "redis",
  });
  await app.close();
});

test("GET /metrics reports operational counters", async () => {
  const app = buildTestApp();

  const response = await app.inject({ method: "GET", url: "/metrics" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    brokerType: testBrokerType,
    channelsCreated: 0,
    channelRateLimits: 0,
    proxyRequests: 0,
    proxyResponses: 0,
    proxyTimeouts: 0,
    brokerErrors: 0,
    clientAuthSuccesses: 0,
    clientAuthFailures: 0,
    clientCredentialsCreated: 0,
    clientCredentialsRevoked: 0,
    authorizationAllowed: 0,
    authorizationDenied: 0,
    invalidScopeConfigurations: 0,
    security: {
      authFailures: { missing: 0, invalid: 0, expired: 0, revoked: 0 },
      authorizationDenials: { no_matching_scope: 0 },
      capacityRejections: { queued: 0, in_flight: 0 },
      requestTimeouts: 0,
      brokerErrors: { unavailable: 0, operation: 0 },
      invalidHosts: { malformed: 0, invalid_channel: 0, invalid_suffix: 0 },
      legacyIsolatedPathBlocks: 0,
      credentialsCreated: 0,
      credentialsRevoked: 0,
      channelsCreated: { path_public: 0, path_bearer: 0, isolated_host_public: 0, isolated_host_bearer: 0 },
      auditEmissionFailures: 0,
      servicesCreated: 0,
      serviceBindings: 0,
      serviceUnbindings: 0,
      serviceAuthFailures: 0,
      signInsStarted: 0,
      accountKeysCreated: 0,
      accountKeysRevoked: 0,
      accountRejections: { missing: 0, invalid: 0, not_owned: 0, limit: 0, disabled: 0 },
    },
    queuedRequests: 0,
    inFlightRequests: 0,
    ...(testBrokerType === "redis" ? { redisCommands: 0, redisPollCommands: 0 } : {}),
  });
  await app.close();
});
