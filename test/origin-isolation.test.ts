import assert from "node:assert/strict";
import { test } from "node:test";

import { buildChannelUrl, normalizeBaseDomain, parseChannelHost } from "../src/origin-routing.js";
import { testBroker } from "./test-broker.js";
import { buildTestApp } from "./build-test-app.js";

const baseDomain = "channels.example.test";
const channelA = "c0a80101-0000-4000-8000-000000000001";
const channelB = "c0a80101-0000-4000-8000-000000000002";

test("isolated URLs use the configured base and exact host shape", () => {
  const a = buildChannelUrl(channelA, baseDomain);
  const b = buildChannelUrl(channelB, baseDomain);
  assert.equal(a, `https://${channelA}.${baseDomain}/`);
  assert.notEqual(new URL(a).origin, new URL(b).origin);

  assert.equal(parseChannelHost(`${channelA}.${baseDomain}`, baseDomain), channelA);
  assert.equal(parseChannelHost(`${channelA.toUpperCase()}.${baseDomain.toUpperCase()}:4117`, baseDomain), channelA);
  assert.equal(parseChannelHost(`${channelA}.${baseDomain}.`, baseDomain), channelA);
  assert.throws(() => normalizeBaseDomain("https://channels.example.test"));
  assert.throws(() => normalizeBaseDomain("*.channels.example.test"));
  assert.throws(() => normalizeBaseDomain("channels.example.test/path"));
  for (const host of [
    `${channelA}.${baseDomain}.evil.com`,
    `evil.${channelA}.${baseDomain}`,
    `${channelA}.extra.${baseDomain}`,
    `${channelA}..${baseDomain}`,
    `.${baseDomain}`,
    `A${baseDomain}`,
    `not-a-uuid.${baseDomain}`,
    `${channelA}.${baseDomain}/path`,
  ]) assert.equal(parseChannelHost(host, baseDomain), null, host);
});

test("path creation stays path-based and isolated creation is configuration-bound", async () => {
  const previous = process.env.AP_CHANNEL_BASE_DOMAIN;
  process.env.AP_CHANNEL_BASE_DOMAIN = baseDomain;
  const app = buildTestApp(testBroker());
  const path = await app.inject({ method: "POST", url: "/channels" });
  assert.equal(path.statusCode, 201);
  assert.match(path.json().url, /^\/c\/[0-9a-f-]+$/);

  const isolated = await app.inject({
    method: "POST", url: "/channels", headers: { host: "attacker.example.test", "x-forwarded-host": "evil.example.test", forwarded: "host=evil.example.test" },
    payload: { exposure: { mode: "isolated-host" } },
  });
  assert.equal(isolated.statusCode, 201);
  assert.equal(isolated.json().url, `https://${isolated.json().channel}.${baseDomain}/`);
  assert.deepEqual(isolated.json().exposure, { mode: "isolated-host" });
  await app.close();

  delete process.env.AP_CHANNEL_BASE_DOMAIN;
  const unconfigured = buildTestApp(testBroker());
  const rejected = await unconfigured.inject({ method: "POST", url: "/channels", payload: { exposure: { mode: "isolated-host" } } });
  assert.equal(rejected.statusCode, 503);
  assert.deepEqual(rejected.json(), { error: "isolated_host_not_configured" });
  await unconfigured.close();
  if (previous === undefined) delete process.env.AP_CHANNEL_BASE_DOMAIN;
  else process.env.AP_CHANNEL_BASE_DOMAIN = previous;
});

test("isolated hosts own every path while legacy shared paths fail closed", async () => {
  const previous = process.env.AP_CHANNEL_BASE_DOMAIN;
  process.env.AP_CHANNEL_BASE_DOMAIN = baseDomain;
  const broker = testBroker();
  const app = buildTestApp(broker);
  const created = await app.inject({ method: "POST", url: "/channels", payload: { exposure: { mode: "isolated-host" } } });
  const { channel, secret, url } = created.json();
  const host = new URL(url).host;

  const legacy = await app.inject({ method: "GET", url: `/c/${channel}/foo` });
  assert.equal(legacy.statusCode, 404);

  const downstream = app.inject({ method: "GET", url: "/channels", headers: { host } });
  const pending = await app.inject({ method: "GET", url: `/channels/${channel}/next`, headers: { authorization: `Bearer ${secret}` } });
  assert.equal(pending.statusCode, 200);
  assert.equal(pending.json().path, "/channels");
  await app.inject({ method: "POST", url: `/channels/${channel}/responses/${pending.json().id}`, headers: { authorization: `Bearer ${secret}` }, payload: { statusCode: 200, body: "ok" } });
  assert.equal((await downstream).body, "ok");

  const control = app.inject({ method: "GET", url: "/health", headers: { host } });
  const healthPending = await app.inject({ method: "GET", url: `/channels/${channel}/next`, headers: { authorization: `Bearer ${secret}` } });
  assert.equal(healthPending.json().path, "/health");
  await app.inject({ method: "POST", url: `/channels/${channel}/responses/${healthPending.json().id}`, headers: { authorization: `Bearer ${secret}` }, payload: { statusCode: 200, body: "downstream-health" } });
  assert.equal((await control).body, "downstream-health");

  const second = await app.inject({ method: "POST", url: "/channels", payload: { exposure: { mode: "path" }, access: { mode: "bearer", scopes: [{ methods: ["GET"], path: "/allowed/*" }] } } });
  const secondBody = second.json();
  const wrongHost = app.inject({ method: "GET", url: `/c/${secondBody.channel}/allowed/item`, headers: { host, "x-ap-access-token": secondBody.access.token } });
  const crossPending = await app.inject({ method: "GET", url: `/channels/${channel}/next`, headers: { authorization: `Bearer ${secret}` } });
  assert.equal(crossPending.json().path, `/c/${secondBody.channel}/allowed/item`);
  await app.inject({ method: "POST", url: `/channels/${channel}/responses/${crossPending.json().id}`, headers: { authorization: `Bearer ${secret}` }, payload: { statusCode: 200, body: "host-authoritative" } });
  assert.equal((await wrongHost).body, "host-authoritative");

  const protectedCreated = await app.inject({ method: "POST", url: "/channels", payload: { exposure: { mode: "isolated-host" }, access: { mode: "bearer", scopes: [{ methods: ["GET"], path: "/allowed/*" }] } } });
  const protectedBody = protectedCreated.json();
  const protectedHost = new URL(protectedBody.url).host;
  assert.equal((await app.inject({ method: "GET", url: "/allowed/item", headers: { host: protectedHost } })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/denied", headers: { host: protectedHost, "x-ap-access-token": protectedBody.access.token } })).statusCode, 403);

  const spoofed = await app.inject({ method: "GET", url: `/c/${channel}/foo`, headers: { host: `${channel}.${baseDomain}.evil.com`, "x-forwarded-host": host } });
  assert.equal(spoofed.statusCode, 404);
  await app.close();
  if (previous === undefined) delete process.env.AP_CHANNEL_BASE_DOMAIN;
  else process.env.AP_CHANNEL_BASE_DOMAIN = previous;
});

test("the bare base domain serves AP itself, not channel traffic", async () => {
  const previous = process.env.AP_CHANNEL_BASE_DOMAIN;
  process.env.AP_CHANNEL_BASE_DOMAIN = baseDomain;
  const app = buildTestApp(testBroker());
  try {
    const health = await app.inject({ method: "GET", url: "/health", headers: { host: baseDomain } });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().service, "ap");
    const created = await app.inject({ method: "POST", url: "/channels", headers: { host: `${baseDomain.toUpperCase()}:443` }, payload: { exposure: { mode: "isolated-host" } } });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().url, `https://${created.json().channel}.${baseDomain}/`);
    const notAChannel = await app.inject({ method: "GET", url: "/health", headers: { host: `www.${baseDomain}` } });
    assert.equal(notAChannel.statusCode, 404);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.AP_CHANNEL_BASE_DOMAIN;
    else process.env.AP_CHANNEL_BASE_DOMAIN = previous;
  }
});
