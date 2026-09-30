import assert from "node:assert/strict";
import { test } from "node:test";

import { buildChannelUrl, parseChannelHost } from "../src/origin-routing.js";
import { ChannelBroker } from "../src/channel-broker.js";
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
  const app = buildTestApp(new ChannelBroker());
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
  const unconfigured = buildTestApp(new ChannelBroker());
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
  const broker = new ChannelBroker();
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

  const control = await app.inject({ method: "GET", url: "/health", headers: { host } });
  assert.notEqual(control.json()?.service, "ap");
  assert.equal(control.statusCode, 504);

  const spoofed = await app.inject({ method: "GET", url: `/c/${channel}/foo`, headers: { host: `${channel}.${baseDomain}.evil.com`, "x-forwarded-host": host } });
  assert.equal(spoofed.statusCode, 404);
  await app.close();
  if (previous === undefined) delete process.env.AP_CHANNEL_BASE_DOMAIN;
  else process.env.AP_CHANNEL_BASE_DOMAIN = previous;
});
