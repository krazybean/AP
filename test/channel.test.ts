import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTestApp } from "./build-test-app.js";

test("channel proxies a request to a polling downstream", async () => {
  const app = buildTestApp();

  const created = await app.inject({ method: "POST", url: "/channels" });
  assert.equal(created.statusCode, 201);
  const { channel, secret } = created.json() as { channel: string; secret: string };

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
    payload: { statusCode: 200, body: { pong: true } },
  });
  assert.equal(response.statusCode, 202);

  const completed = await publicRequest;
  assert.equal(completed.statusCode, 200);
  assert.deepEqual(completed.json(), { pong: true });

  await app.close();
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
    url: `/channels/${channel}/responses/not-a-request`,
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
    url: `/channels/${channel}/responses/not-a-request`,
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
