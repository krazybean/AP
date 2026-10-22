import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTestApp } from "./build-test-app.js";
import { testBroker } from "./test-broker.js";

const baseDomain = "channels.example.test";

async function withEnv(env: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("channels default to path exposure", async () => {
  await withEnv({ AP_DEFAULT_EXPOSURE: undefined, AP_CHANNEL_BASE_DOMAIN: baseDomain }, async () => {
    const app = buildTestApp(testBroker());
    const created = await app.inject({ method: "POST", url: "/channels" });
    assert.equal(created.statusCode, 201);
    assert.match(created.json().url, /^\/c\//);
    await app.close();
  });
});

test("AP_DEFAULT_EXPOSURE=isolated-host gives channels their own hostname unless they ask for a path", async () => {
  await withEnv({ AP_DEFAULT_EXPOSURE: "isolated-host", AP_CHANNEL_BASE_DOMAIN: baseDomain }, async () => {
    const app = buildTestApp(testBroker());
    for (const payload of [undefined, {}, { access: { mode: "public" } }]) {
      const created = await app.inject({ method: "POST", url: "/channels", ...(payload ? { payload } : {}) });
      assert.equal(created.statusCode, 201, JSON.stringify(payload));
      assert.equal(created.json().url, `https://${created.json().channel}.${baseDomain}/`);
      assert.deepEqual(created.json().exposure, { mode: "isolated-host" });
    }
    const path = await app.inject({ method: "POST", url: "/channels", payload: { exposure: { mode: "path" } } });
    assert.equal(path.statusCode, 201);
    assert.match(path.json().url, /^\/c\//);
    await app.close();
  });
});

test("an isolated default without a base domain fails channel creation clearly", async () => {
  await withEnv({ AP_DEFAULT_EXPOSURE: "isolated-host", AP_CHANNEL_BASE_DOMAIN: undefined }, async () => {
    const app = buildTestApp(testBroker());
    const created = await app.inject({ method: "POST", url: "/channels" });
    assert.equal(created.statusCode, 503);
    assert.deepEqual(created.json(), { error: "isolated_host_not_configured" });
    await app.close();
  });
});

test("an unknown AP_DEFAULT_EXPOSURE stops startup", async () => {
  await withEnv({ AP_DEFAULT_EXPOSURE: "subdomain" }, async () => {
    assert.throws(() => buildTestApp(testBroker()), /AP_DEFAULT_EXPOSURE/);
  });
});
