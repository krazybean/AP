import assert from "node:assert/strict";
import { test } from "node:test";

import { ChannelBroker } from "../src/channel-broker.js";
import { buildTestApp } from "./build-test-app.js";
import { testBroker } from "./test-broker.js";
import { sourceRateLimitKey } from "../src/routes.js";

test("channel proxies a request to a polling downstream", async () => {
  const app = buildTestApp();

  const created = await app.inject({ method: "POST", url: "/channels" });
  assert.equal(created.statusCode, 201);
  const { channel, secret, url } = created.json() as { channel: string; secret: string; url: string };
  assert.ok(channel);
  assert.ok(secret);
  assert.equal(url, `/c/${channel}`);

  const publicRequest = app.inject({ method: "GET", url: `/c/${channel}/ping` });

  const next = await app.inject({
    method: "GET",
    url: `/channels/${channel}/next`,
    headers: { authorization: `Bearer ${secret}` },
  });

  assert.equal(next.statusCode, 200);
  const pending = next.json() as { id: string; method: string; path: string };
  assert.equal(pending.method, "GET");
  assert.equal(pending.path, "/ping");

  const response = await app.inject({
    method: "POST",
    url: `/channels/${channel}/responses/${pending.id}`,
    headers: { authorization: `Bearer ${secret}` },
    payload: { statusCode: 201, headers: { "content-type": "application/json", "x-app-result": "ok" }, body: { pong: true } },
  });
  assert.equal(response.statusCode, 202);

  const completed = await publicRequest;
  assert.equal(completed.statusCode, 201);
  assert.match(completed.headers["content-type"], /^application\/json/);
  assert.equal(completed.headers["x-app-result"], "ok");
  assert.deepEqual(completed.json(), { pong: true });

  await app.close();
});

test("root and nested POST requests preserve paths, headers, and body", async () => {
  const app = buildTestApp();
  const created = await app.inject({ method: "POST", url: "/channels" });
  const { channel, secret } = created.json() as { channel: string; secret: string };

  for (const [url, expectedPath] of [[`/c/${channel}`, "/"], [`/c/${channel}/nested/path`, "/nested/path"]]) {
    const body = { message: "hello", count: 3 };
    const publicRequest = app.inject({
      method: "POST",
      url,
      headers: { authorization: "Bearer application-token", "content-type": "application/json", "x-app-trace": "trace-123" },
      payload: body,
    });
    const next = await app.inject({
      method: "GET",
      url: `/channels/${channel}/next`,
      headers: { authorization: `Bearer ${secret}` },
    });
    assert.equal(next.statusCode, 200);
    const pending = next.json() as { id: string; method: string; path: string; headers: Record<string, string>; body: unknown };
    assert.equal(pending.method, "POST");
    assert.equal(pending.path, expectedPath);
    assert.equal(pending.headers.authorization, "Bearer application-token");
    assert.equal(pending.headers["content-type"], "application/json");
    assert.equal(pending.headers["x-app-trace"], "trace-123");
    assert.deepEqual(pending.body, body);

    await app.inject({
      method: "POST",
      url: `/channels/${channel}/responses/${pending.id}`,
      headers: { authorization: `Bearer ${secret}` },
      payload: { statusCode: 200, body: { received: pending.body } },
    });
    const completed = await publicRequest;
    assert.equal(completed.statusCode, 200);
    assert.deepEqual(completed.json(), { received: body });
  }
  await app.close();
});

test("JSON object response bodies are forwarded as JSON", async () => {
  const app = buildTestApp();
  const created = await app.inject({ method: "POST", url: "/channels" });
  const { channel, secret } = created.json() as { channel: string; secret: string };

  for (const body of [{ protocol: "APP/1.0" }, { projects: [] }]) {
    const publicRequest = app.inject({
      method: "GET",
      url: `/c/${channel}`,
    });
    const next = await app.inject({
      method: "GET",
      url: `/channels/${channel}/next`,
      headers: { authorization: `Bearer ${secret}` },
    });
    const pending = next.json() as { id: string };

    const response = await app.inject({
      method: "POST",
      url: `/channels/${channel}/responses/${pending.id}`,
      headers: { authorization: `Bearer ${secret}` },
      payload: { statusCode: 200, headers: { "content-type": "application/json" }, body },
    });
    assert.equal(response.statusCode, 202);

    const completed = await publicRequest;
    assert.equal(completed.statusCode, 200);
    assert.deepEqual(completed.json(), body);
  }

  await app.close();
});

test("empty downstream polling returns 204 and incorrect secret returns 401", async () => {
  const broker = testBroker();
  const { id: channel, secret } = await broker.createChannel();
  const app = buildTestApp(broker);

  const unauthorized = await app.inject({
    method: "GET",
    url: `/channels/${channel}/next`,
    headers: { authorization: "Bearer incorrect-secret" },
  });
  assert.equal(unauthorized.statusCode, 401);

  const emptyBroker = {
    type: "memory",
    next: async () => null,
  } as never;
  const emptyApp = buildTestApp(emptyBroker);
  const empty = await emptyApp.inject({
    method: "GET",
    url: `/channels/${channel}/next`,
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(empty.statusCode, 204);
  await app.close();
  await emptyApp.close();
});

test("an unanswered downstream request returns 504", async () => {
  const app = buildTestApp({
    type: "memory",
    health: async () => {},
    metrics: () => ({ queuedRequests: 0, inFlightRequests: 0 }),
    createChannel: async () => ({ id: "c0a80101-0000-4000-8000-000000000001", secret: "secret" }),
    hasChannel: async () => true,
    channelExposure: async () => "path" as const,
    dispatch: async () => { throw new Error("DOWNSTREAM_TIMEOUT"); },
    next: async () => null,
    respond: async () => {},
    authenticateClient: async () => {},
    createClientCredential: async () => ({ id: "credential", token: "token", createdAt: Date.now() }),
    revokeClientCredential: async () => {},
  });
  const response = await app.inject({ method: "GET", url: "/c/c0a80101-0000-4000-8000-000000000001" });
  assert.equal(response.statusCode, 504);
  assert.deepEqual(response.json(), { error: "downstream_timeout" });
  await app.close();
});

test("late or duplicate responses cannot complete a finished memory request", async () => {
  const broker = new ChannelBroker();
  const { id: channel, secret } = await broker.createChannel();
  const result = broker.dispatch(channel, { method: "GET", path: "/", headers: {}, body: null }, 1_000);
  const pending = await broker.next(channel, secret, 1_000);
  assert.ok(pending);
  const response = { statusCode: 200, body: "first" };
  await broker.respond(channel, secret, pending.id, response);
  assert.deepEqual(await result, response);
  await assert.rejects(broker.respond(channel, secret, pending.id, { statusCode: 200, body: "late" }), /REQUEST_NOT_FOUND/);

  const timedOut = broker.dispatch(channel, { method: "GET", path: "/", headers: {}, body: null }, 1);
  const expired = await broker.next(channel, secret, 1_000);
  assert.ok(expired);
  await assert.rejects(timedOut, /DOWNSTREAM_TIMEOUT/);
  await assert.rejects(broker.respond(channel, secret, expired.id, { statusCode: 200, body: "too late" }), /REQUEST_NOT_FOUND/);
  const queued = broker.metrics().queuedRequests + broker.metrics().inFlightRequests;
  assert.equal(queued, 0);
});

test("unknown channel traffic returns a not-found error", async () => {
  const app = buildTestApp();

  const response = await app.inject({
    method: "GET",
    url: "/c/not-a-channel/ping",
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "channel_not_found" });
  await app.close();
});

test("unknown channel polling returns a not-found error", async () => {
  const app = buildTestApp();

  const response = await app.inject({
    method: "GET",
    url: "/channels/not-a-channel/next",
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "channel_not_found" });
  await app.close();
});

test("unknown response request returns a not-found error", async () => {
  const app = buildTestApp();
  const created = await app.inject({ method: "POST", url: "/channels" });
  const { channel, secret } = created.json() as { channel: string; secret: string };

  const response = await app.inject({
    method: "POST",
    url: `/channels/${channel}/responses/c0a80101-0000-4000-8000-000000000001`,
    headers: { authorization: `Bearer ${secret}` },
    payload: { statusCode: 200, body: { ok: true } },
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "request_not_found" });
  await app.close();
});

test("downstream requests require the channel secret", async () => {
  const app = buildTestApp();
  const created = await app.inject({ method: "POST", url: "/channels" });
  const { channel } = created.json() as { channel: string };

  const response = await app.inject({
    method: "GET",
    url: `/channels/${channel}/next`,
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "channel_unauthorized" });
  await app.close();
});

test("invalid downstream response envelopes are rejected", async () => {
  const app = buildTestApp();
  const created = await app.inject({ method: "POST", url: "/channels" });
  const { channel, secret } = created.json() as { channel: string; secret: string };

  const response = await app.inject({
    method: "POST",
    url: `/channels/${channel}/responses/c0a80101-0000-4000-8000-000000000001`,
    headers: { authorization: `Bearer ${secret}` },
    payload: { statusCode: "200" },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "invalid_response" });
  await app.close();
});

test("channel creation is rate limited per source", async () => {
  const app = buildTestApp();

  for (let index = 0; index < 10; index += 1) {
    const response = await app.inject({ method: "POST", url: "/channels" });
    assert.equal(response.statusCode, 201);
  }

  const limited = await app.inject({ method: "POST", url: "/channels" });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers["retry-after"], "3600");
  assert.deepEqual(limited.json(), { error: "channel_rate_limited" });
  await app.close();
});

test("source rate-limit keys normalize IPv4-mapped addresses", () => {
  assert.equal(sourceRateLimitKey("::ffff:192.0.2.1"), "192.0.2.1");
  assert.equal(sourceRateLimitKey("2001:DB8::1"), "2001:db8::1");
});

test("channel creation can mandate an application license", async () => {
  const previous = process.env.REQUIRE_LICENSE;
  process.env.REQUIRE_LICENSE = "true";
  const app = buildTestApp();

  try {
    const missing = await app.inject({ method: "POST", url: "/channels" });
    assert.equal(missing.statusCode, 401);
    assert.deepEqual(missing.json(), { error: "application_license_required" });

    const accepted = await app.inject({
      method: "POST",
      url: "/channels",
      headers: { "x-app-license": "prototype-license" },
    });
    assert.equal(accepted.statusCode, 201);
  } finally {
    if (previous === undefined) delete process.env.REQUIRE_LICENSE;
    else process.env.REQUIRE_LICENSE = previous;
    await app.close();
  }
});
