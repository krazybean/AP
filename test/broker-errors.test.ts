import assert from "node:assert/strict";
import { test } from "node:test";

import { BrokerUnavailableError } from "../src/broker.js";
import { buildTestApp } from "./build-test-app.js";

function unavailableBroker(retryAfterSeconds?: number) {
  const fail = async () => {
    throw new BrokerUnavailableError("BROKER_UNAVAILABLE", retryAfterSeconds);
  };
  return {
    type: "redis",
    health: async () => {},
    metrics: () => ({ queuedRequests: 0, inFlightRequests: 0 }),
    createChannel: fail,
    hasChannel: async () => true,
    dispatch: fail,
    next: fail,
    respond: fail,
  } as never;
}

test("broker infrastructure failures return 503 and preserve retry-after", async () => {
  const app = buildTestApp(unavailableBroker(17));
  const response = await app.inject({ method: "POST", url: "/channels" });

  assert.equal(response.statusCode, 503);
  assert.equal(response.headers["retry-after"], "17");
  assert.deepEqual(response.json(), { error: "broker_unavailable" });
  await app.close();
});

test("broker infrastructure failures are distinct from AP channel rate limits", async () => {
  const app = buildTestApp(unavailableBroker());
  const response = await app.inject({ method: "POST", url: "/channels" });

  assert.equal(response.statusCode, 503);
  assert.equal(response.headers["retry-after"], undefined);
  assert.deepEqual(response.json(), { error: "broker_unavailable" });
  await app.close();
});
