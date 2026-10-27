import assert from "node:assert/strict";
import { test } from "node:test";

import { BrokerUnavailableError, type Broker } from "../src/broker.js";
import { ChannelBroker } from "../src/channel-broker.js";
import { buildTestApp } from "./build-test-app.js";
import { testBroker } from "./test-broker.js";

async function proxyWith(response: unknown) {
  const broker = testBroker();
  const { id, secret } = await broker.createChannel();
  const app = buildTestApp(broker);
  const client = app.inject({ method: "GET", url: `/c/${id}/x` });
  const pending = await broker.next(id, secret, 2_000);
  assert.ok(pending);
  const delivered = await app.inject({
    method: "POST",
    url: `/channels/${id}/responses/${pending.id}`,
    headers: { authorization: `Bearer ${secret}` },
    payload: response as Record<string, unknown>,
  });
  return { app, broker, id, secret, pendingId: pending.id, delivered, client };
}

test("object response bodies default to a JSON content type", async () => {
  const { app, delivered, client } = await proxyWith({ statusCode: 200, body: { protocol: "APP/1.0" } });
  assert.equal(delivered.statusCode, 202);
  const completed = await client;
  assert.match(String(completed.headers["content-type"]), /^application\/json/);
  assert.deepEqual(completed.json(), { protocol: "APP/1.0" });
  await app.close();
});

test("a downstream content type still wins over the JSON default", async () => {
  const { app, client } = await proxyWith({ statusCode: 200, headers: { "Content-Type": "application/vnd.app+json" }, body: { a: 1 } });
  assert.match(String((await client).headers["content-type"]), /^application\/vnd\.app\+json/);
  await app.close();
});

test("downstream content-encoding and content-length are not forwarded", async () => {
  // AP re-serializes the body, so encoding and length headers from the app can never be correct.
  const { app, client } = await proxyWith({ statusCode: 200, headers: { "content-encoding": "gzip", "content-length": "2" }, body: "plain" });
  const completed = await client;
  assert.equal(completed.headers["content-encoding"], undefined);
  assert.equal(completed.body, "plain");
  await app.close();
});

test("informational status codes are rejected as downstream responses", async () => {
  for (const statusCode of [100, 101, 199]) {
    const { app, broker, id, secret, pendingId, delivered, client } = await proxyWith({ statusCode, body: "x" });
    assert.equal(delivered.statusCode, 400, String(statusCode));
    assert.deepEqual(delivered.json(), { error: "invalid_response" });
    await broker.respond(id, secret, pendingId, { statusCode: 200, body: "ok" });
    assert.equal((await client).statusCode, 200);
    await app.close();
  }
});

test("invalid downstream header names or values are rejected before the client sees a 500", async () => {
  for (const headers of [{ "x-bad": "a\r\nInjected: yes" }, { "bad name": "v" }, { "x-nul": "a\u0000b" }]) {
    const { app, broker, id, secret, pendingId, delivered, client } = await proxyWith({ statusCode: 200, headers, body: "x" });
    assert.equal(delivered.statusCode, 400, JSON.stringify(headers));
    assert.deepEqual(delivered.json(), { error: "invalid_response" });
    await broker.respond(id, secret, pendingId, { statusCode: 200, body: "ok" });
    const completed = await client;
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.headers.injected, undefined);
    await app.close();
  }
});

test("a broker outage on an isolated host returns 503, not 500", async () => {
  const previous = process.env.AP_CHANNEL_BASE_DOMAIN;
  process.env.AP_CHANNEL_BASE_DOMAIN = "channels.example.test";
  const broker = new ChannelBroker();
  broker.channelExposure = async () => { throw new BrokerUnavailableError("BROKER_UNAVAILABLE", 5); };
  const app = buildTestApp(broker);
  try {
    const response = await app.inject({ method: "GET", url: "/", headers: { host: "c0a80101-0000-4000-8000-000000000001.channels.example.test" } });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: "broker_unavailable" });
    assert.equal(response.headers["retry-after"], "5");
  } finally {
    if (previous === undefined) delete process.env.AP_CHANNEL_BASE_DOMAIN;
    else process.env.AP_CHANNEL_BASE_DOMAIN = previous;
    await app.close();
  }
});

test("service creation normalizes the source address like channel creation", async () => {
  const keys: string[] = [];
  const broker = {
    type: "memory",
    createService: async (name: string, rateLimitKey: string) => {
      keys.push(rateLimitKey);
      return { serviceId: "c0a80101-0000-4000-8000-000000000009", name, createdAt: new Date().toISOString(), secret: "aps_x" };
    },
  } as unknown as Broker;
  const app = buildTestApp(broker);
  await app.inject({ method: "POST", url: "/services", payload: { name: "billing" }, remoteAddress: "::ffff:192.0.2.1" });
  assert.deepEqual(keys, ["192.0.2.1"]);
  await app.close();
});

test("client auth successes count only authenticated tokens", async () => {
  const broker = testBroker();
  const { id, secret } = await broker.createChannel();
  const app = buildTestApp(broker);
  const client = app.inject({ method: "GET", url: `/c/${id}/x`, headers: { "x-ap-access-token": "apc_not-needed-on-public" } });
  const pending = await broker.next(id, secret, 2_000);
  assert.ok(pending);
  await broker.respond(id, secret, pending.id, { statusCode: 200, body: "ok" });
  assert.equal((await client).statusCode, 200);
  const metrics = (await app.inject({ method: "GET", url: "/metrics" })).json();
  assert.equal(metrics.clientAuthSuccesses, 0);
  await app.close();
});

test("a rejected channel secret on service binding is audited by that secret's presence", async () => {
  const events: { event: string; reason?: string }[] = [];
  const broker = testBroker();
  const service = await broker.createService("audited");
  const channel = await broker.createChannel();
  const Fastify = (await import("fastify")).default;
  const { registerRoutes } = await import("../src/routes.js");
  const app = Fastify();
  registerRoutes(app, broker, { auditSink: { emit: (event) => events.push(event) } });
  const response = await app.inject({
    method: "PUT",
    url: `/services/audited/instances/${channel.id}`,
    headers: { "x-ap-service-secret": service.secret },
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(events.filter((event) => event.event === "service.auth_rejected").map((event) => event.reason), ["missing"]);
  await app.close();
});

test("memory broker forgets expired creation windows and expired channels", async () => {
  const broker = new ChannelBroker();
  const internals = broker as unknown as {
    creationLimits: Map<string, { count: number; expiresAt: number }>;
    channels: Map<string, { expiresAt: number }>;
    lastSweepAt: number;
  };
  const { id } = await broker.createChannel("198.51.100.1");
  internals.creationLimits.get("198.51.100.1")!.expiresAt = Date.now() - 1;
  internals.channels.get(id)!.expiresAt = Date.now() - 1;
  internals.lastSweepAt = 0;
  await broker.createChannel("198.51.100.2");
  assert.equal(internals.creationLimits.has("198.51.100.1"), false);
  assert.equal(internals.channels.has(id), false);
});

test("X-AP-Activity: none on /next does not refresh the channel, any other value does", async () => {
  const broker = testBroker();
  const { id, secret } = await broker.createChannel();
  const app = buildTestApp(broker);
  const channel = (broker as unknown as { channels: Map<string, { expiresAt: number }> }).channels.get(id)!;
  const poll = (activity?: string) => app.inject({
    method: "GET",
    url: `/channels/${id}/next`,
    headers: { authorization: `Bearer ${secret}`, ...(activity === undefined ? {} : { "x-ap-activity": activity }) },
  });
  const rewind = () => { channel.expiresAt = Date.now() + 1_000; return channel.expiresAt; };

  for (const [value, refreshes] of [["none", false], [" NONE ", false], ["active", true], ["", true], [undefined, true]] as const) {
    const before = rewind();
    const original = broker.next.bind(broker);
    broker.next = ((c, s, _w, a) => original(c, s, 0, a)) as typeof broker.next;
    const response = await poll(value);
    broker.next = original;
    assert.equal(response.statusCode, 204);
    assert.equal(channel.expiresAt > before, refreshes, `header ${JSON.stringify(value)}`);
  }
});
