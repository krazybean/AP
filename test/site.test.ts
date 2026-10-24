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

test("the landing hero is a video stacked over its own fallbacks", async () => {
  const app = buildTestApp(testBroker());
  const response = await app.inject({ method: "GET", url: "/" });
  const html = response.body;
  const video = html.match(/<video[^>]*>.*?<\/video>/s)?.[0] ?? "";
  assert.match(video, /\bautoplay\b/);
  assert.match(video, /\bmuted\b/);
  assert.match(video, /\bloop\b/);
  assert.match(video, /\bplaysinline\b/);
  assert.ok(!/\bcontrols\b/.test(video), "controls would paint over the fallback layers when the video fails");
  assert.match(video, /<source src="\/hero-[0-9a-f]{10}\.mp4" type="video\/mp4">/);
  // The layers under the video, in painting order: the still frame, over the static diagram.
  assert.ok(html.indexOf('class="stage-static"') < html.indexOf('class="stage-still"'));
  assert.ok(html.indexOf('class="stage-still"') < html.indexOf("<video"));
  assert.match(html, /<svg class="diagram"/);
  assert.match(html, /\.stage-still \{[^}]*url\("\/hero-[0-9a-f]{10}\.jpg"\)/);
  assert.match(html, /prefers-reduced-motion: reduce\) \{ \.stage-video \{ display: none; \}/);
  // Only AP's own origin may supply media; nothing else loosens.
  const csp = response.headers["content-security-policy"] as string;
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /media-src 'self'/);
  assert.match(csp, /img-src data: 'self'/);
  assert.ok(!/script-src|connect-src|frame-src/.test(csp));
  assert.ok(!/<script/i.test(html));
  await app.close();
});

test("the static hero is the backout: /?hero=static and AP_HERO_VIDEO=off drop the video", async () => {
  const app = buildTestApp(testBroker());
  const bodies = [(await app.inject({ method: "GET", url: "/?hero=static" })).body];
  const previous = process.env.AP_HERO_VIDEO;
  try {
    for (const value of ["off", "OFF", "false", "0"]) {
      process.env.AP_HERO_VIDEO = value;
      bodies.push((await app.inject({ method: "GET", url: "/" })).body);
    }
    for (const html of bodies) {
      assert.ok(!/<video/i.test(html), "no video element");
      assert.ok(!/<source/i.test(html), "no media source");
      assert.ok(html.includes("<h1>Give a private application a public HTTPS URL.</h1>"));
      assert.match(html, /<svg class="mark"[^>]*width="132"/, "the original mark");
      assert.match(html, /<svg class="diagram"/);
    }
    process.env.AP_HERO_VIDEO = "on";
    assert.match((await app.inject({ method: "GET", url: "/" })).body, /<video/);
    // The switch is for the home page: the video stays on a plain request once the variable is gone.
    delete process.env.AP_HERO_VIDEO;
    assert.match((await app.inject({ method: "GET", url: "/" })).body, /<video/);
  } finally {
    if (previous === undefined) delete process.env.AP_HERO_VIDEO;
    else process.env.AP_HERO_VIDEO = previous;
  }
  await app.close();
});

test("the hero media is served with Range support so Safari can play it", async () => {
  const app = buildTestApp(testBroker());
  const html = (await app.inject({ method: "GET", url: "/" })).body;
  const videoPath = html.match(/<source src="([^"]+)"/)![1];
  const posterPath = html.match(/url\("(\/hero-[0-9a-f]{10}\.jpg)"\)/)![1];

  const full = await app.inject({ method: "GET", url: videoPath });
  assert.equal(full.statusCode, 200);
  assert.equal(full.headers["content-type"], "video/mp4");
  assert.equal(full.headers["accept-ranges"], "bytes");
  assert.match(String(full.headers["cache-control"]), /immutable/);
  assert.equal(full.headers["x-content-type-options"], "nosniff");
  assert.equal(full.rawPayload.subarray(4, 8).toString("latin1"), "ftyp", "a real MP4");
  const size = full.rawPayload.length;

  const head = await app.inject({ method: "HEAD", url: videoPath });
  assert.equal(head.statusCode, 200);
  assert.equal(head.headers["content-length"], String(size));

  const first = await app.inject({ method: "GET", url: videoPath, headers: { range: "bytes=0-99" } });
  assert.equal(first.statusCode, 206);
  assert.equal(first.headers["content-range"], `bytes 0-99/${size}`);
  assert.deepEqual(first.rawPayload, full.rawPayload.subarray(0, 100));

  const open = await app.inject({ method: "GET", url: videoPath, headers: { range: `bytes=${size - 10}-` } });
  assert.equal(open.statusCode, 206);
  assert.deepEqual(open.rawPayload, full.rawPayload.subarray(size - 10));

  const suffix = await app.inject({ method: "GET", url: videoPath, headers: { range: "bytes=-25" } });
  assert.equal(suffix.statusCode, 206);
  assert.deepEqual(suffix.rawPayload, full.rawPayload.subarray(size - 25));

  const clamped = await app.inject({ method: "GET", url: videoPath, headers: { range: `bytes=${size - 5}-${size + 9999}` } });
  assert.equal(clamped.statusCode, 206);
  assert.equal(clamped.headers["content-range"], `bytes ${size - 5}-${size - 1}/${size}`);

  for (const bad of [`bytes=${size}-`, "bytes=50-10", "bytes=-0"]) {
    const response = await app.inject({ method: "GET", url: videoPath, headers: { range: bad } });
    assert.equal(response.statusCode, 416, bad);
    assert.equal(response.headers["content-range"], `bytes */${size}`);
  }
  // Ranges AP does not understand are ignored, as the HTTP spec allows, and the whole file is sent.
  for (const odd of ["bytes=0-1,5-9", "items=0-9", "bytes=-"]) {
    assert.equal((await app.inject({ method: "GET", url: videoPath, headers: { range: odd } })).statusCode, 200, odd);
  }

  const poster = await app.inject({ method: "GET", url: posterPath });
  assert.equal(poster.statusCode, 200);
  assert.equal(poster.headers["content-type"], "image/jpeg");
  assert.deepEqual([...poster.rawPayload.subarray(0, 2)], [0xff, 0xd8], "a real JPEG");
  assert.equal((await app.inject({ method: "GET", url: "/hero-0000000000.mp4" })).statusCode, 404);
  await app.close();
});

test("channel hostnames never serve the hero media either", async () => {
  await withBaseDomain("apchannels.test", async () => {
    const app = buildTestApp(testBroker());
    const html = (await app.inject({ method: "GET", url: "/", headers: { host: "apchannels.test" } })).body;
    const videoPath = html.match(/<source src="([^"]+)"/)![1];
    assert.equal((await app.inject({ method: "GET", url: videoPath, headers: { host: "apchannels.test" } })).statusCode, 200);
    const response = await app.inject({ method: "GET", url: videoPath, headers: { host: `${channel}.apchannels.test` } });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: "not_found" });
    await app.close();
  });
});
