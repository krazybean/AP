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

test("memory broker keeps only a digest of the channel secret", async () => {
  const broker = new ChannelBroker();
  const { id, secret } = await broker.createChannel();
  const channel = (broker as unknown as { channels: Map<string, Record<string, unknown>> }).channels.get(id)!;

  assert.equal("secret" in channel, false);
  assert.ok(Buffer.isBuffer(channel.secretDigest));
  assert.equal(await broker.next(id, secret, 0), null);
  await assert.rejects(broker.next(id, `${secret}x`, 0), /CHANNEL_UNAUTHORIZED/);
});

test("memory broker answers an activity-none poll at once, without refreshing or delivering", async () => {
  const broker = new ChannelBroker();
  const { id, secret } = await broker.createChannel();
  const channel = (broker as unknown as { channels: Map<string, { expiresAt: number }> }).channels.get(id)!;
  const queued = broker.dispatch(id, { method: "GET", path: "/", headers: {}, body: null }, 1_000);
  channel.expiresAt = Date.now() + 1_000; // admission refreshed it; start from a known value
  const before = channel.expiresAt;

  const started = Date.now();
  assert.equal(await broker.next(id, secret, 25_000, "none"), null);
  assert.ok(Date.now() - started < 500, "must not wait");
  assert.equal(channel.expiresAt, before);
  await assert.rejects(broker.next(id, `${secret}x`, 0, "none"), /CHANNEL_UNAUTHORIZED/);

  const pending = await broker.next(id, secret, 0);
  assert.ok(pending);
  assert.ok(channel.expiresAt > before);
  await broker.respond(id, secret, pending.id, { statusCode: 200 });
  await queued;
});
