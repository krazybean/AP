import assert from "node:assert/strict";
import { test } from "node:test";
import { BrokerCapacityError } from "../src/broker.js";
import { ChannelBroker } from "../src/channel-broker.js";

test("memory broker bounds queued and delivered work and releases capacity", async () => {
  const broker = new ChannelBroker({ maxQueuedPerChannel: 1, maxInFlightPerChannel: 1 });
  const { id, secret } = await broker.createChannel();
  const request = { method: "GET", path: "/", headers: {}, body: null };
  const first = broker.dispatch(id, request, 1_000);
  await assert.rejects(broker.dispatch(id, request), BrokerCapacityError);
  const delivered = await broker.next(id, secret, 0);
  assert.ok(delivered);
  const second = broker.dispatch(id, request, 1_000);
  assert.equal(await broker.next(id, secret, 0), null);
  await broker.respond(id, secret, delivered.id, { statusCode: 200 });
  await first;
  assert.ok(await broker.next(id, secret, 0));
  await assert.rejects(second, /DOWNSTREAM_TIMEOUT/);
  assert.equal(broker.metrics().queuedRequests + broker.metrics().inFlightRequests, 0);
});
