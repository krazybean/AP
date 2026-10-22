import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTestApp } from "./build-test-app.js";
import { testBroker } from "./test-broker.js";

const baseDomain = "channels.example.test";
const sandbox = "sandbox allow-scripts allow-forms allow-popups allow-downloads";

async function roundTrip(headers: Record<string, string>, isolated = false) {
  const previous = process.env.AP_CHANNEL_BASE_DOMAIN;
  process.env.AP_CHANNEL_BASE_DOMAIN = baseDomain;
  const broker = testBroker();
  const app = buildTestApp(broker);
  try {
    const created = (await app.inject({ method: "POST", url: "/channels", payload: isolated ? { exposure: { mode: "isolated-host" } } : {} })).json();
    const client = isolated
      ? app.inject({ method: "GET", url: "/page", headers: { host: new URL(created.url).host } })
      : app.inject({ method: "GET", url: `/c/${created.channel}/page` });
    const pending = await broker.next(created.channel, created.secret, 2_000);
    assert.ok(pending);
    await broker.respond(created.channel, created.secret, pending.id, { statusCode: 200, headers, body: "<p>hi</p>" });
    return await client;
  } finally {
    if (previous === undefined) delete process.env.AP_CHANNEL_BASE_DOMAIN;
    else process.env.AP_CHANNEL_BASE_DOMAIN = previous;
    await app.close();
  }
}

test("path channel responses are sandboxed and never sniffed", async () => {
  const response = await roundTrip({ "content-type": "text/html", "x-content-type-options": "off" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-security-policy"], sandbox);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.body, "<p>hi</p>");
});

test("a path channel's own CSP is kept alongside the sandbox", async () => {
  const response = await roundTrip({ "content-security-policy": "default-src 'self'" });
  assert.deepEqual(response.headers["content-security-policy"], ["default-src 'self'", sandbox]);
});

test("path channels cannot widen service worker scope", async () => {
  const response = await roundTrip({ "service-worker-allowed": "/" });
  assert.equal(response.headers["service-worker-allowed"], undefined);
});

test("isolated hosts keep the app's own headers unchanged", async () => {
  const response = await roundTrip({ "content-security-policy": "default-src 'self'", "service-worker-allowed": "/" }, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-security-policy"], "default-src 'self'");
  assert.equal(response.headers["service-worker-allowed"], "/");
  assert.equal(response.headers["x-content-type-options"], undefined);
});
