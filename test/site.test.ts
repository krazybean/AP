import assert from "node:assert/strict";
import test from "node:test";

import { buildTestApp } from "./build-test-app.js";
import { testBroker } from "./test-broker.js";

const channel = "c0a80101-0000-4000-8000-000000000001";

async function withBaseDomain<T>(value: string | undefined, run: () => Promise<T>) {
  const previous = process.env.AP_CHANNEL_BASE_DOMAIN;
  if (value === undefined) delete process.env.AP_CHANNEL_BASE_DOMAIN;
  else process.env.AP_CHANNEL_BASE_DOMAIN = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.AP_CHANNEL_BASE_DOMAIN;
    else process.env.AP_CHANNEL_BASE_DOMAIN = previous;
  }
}

test("the landing page and privacy policy are served as locked-down HTML", async () => {
  await withBaseDomain("apchannels.test", async () => {
    const app = buildTestApp(testBroker());
    for (const [url, heading] of [["/", "Give a private application a public HTTPS URL."], ["/privacy", "Privacy policy"]]) {
      const response = await app.inject({ method: "GET", url, headers: { host: "apchannels.test" } });
      assert.equal(response.statusCode, 200, url);
      assert.match(String(response.headers["content-type"]), /^text\/html; charset=utf-8/);
      assert.match(response.headers["content-security-policy"] as string, /default-src 'none'/);
      assert.match(response.headers["content-security-policy"] as string, /frame-ancestors 'none'/);
      assert.equal(response.headers["x-content-type-options"], "nosniff");
      assert.ok(response.body.includes(`<h1>${heading}</h1>`), url);
      assert.ok(!/<script/i.test(response.body), "no scripts");
      assert.ok(!/<(?:img|link|iframe)[^>]+(?:src|href)="https?:/i.test(response.body.replace(/<a [^>]*>/g, "")), "no external subresources");
    }
    await app.close();
  });
});

test("the privacy policy states the Google scopes, retention and contact", async () => {
  const app = buildTestApp(testBroker());
  const body = (await app.inject({ method: "GET", url: "/privacy" })).body;
  for (const text of ["openid", "email", "Google API Services User Data Policy", "15 minutes", "GitHub issues", "does not sell", "DELETE /account", "delete-my-account"]) {
    assert.ok(body.includes(text) || body.toLowerCase().includes(text.toLowerCase()), text);
  }
  await app.close();
});

test("the pages work with no base domain configured", async () => {
  await withBaseDomain(undefined, async () => {
    const app = buildTestApp(testBroker());
    assert.equal((await app.inject({ method: "GET", url: "/" })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/privacy" })).statusCode, 200);
    await app.close();
  });
});

test("channel hostnames never serve AP's pages", async () => {
  await withBaseDomain("apchannels.test", async () => {
    const app = buildTestApp(testBroker());
    for (const url of ["/", "/privacy"]) {
      // A well-formed host for a channel that does not exist, and a malformed name under the base domain.
      for (const host of [`${channel}.apchannels.test`, "www.apchannels.test", "privacy.apchannels.test"]) {
        const response = await app.inject({ method: "GET", url, headers: { host } });
        assert.equal(response.statusCode, 404, `${host}${url}`);
        assert.deepEqual(response.json(), { error: "not_found" });
      }
    }
    await app.close();
  });
});
