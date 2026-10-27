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

const heroPage = async (app: Awaited<ReturnType<typeof buildTestApp>>, query = "", headers: Record<string, string> = {}) =>
  app.inject({ method: "GET", url: `/${query}`, headers });

test("the default hero is the live demo, in an <object> over the recorded still and the diagram", async () => {
  const app = buildTestApp(testBroker());
  const response = await heroPage(app);
  const html = response.body;
  assert.match(html, /<object class="stage-demo" type="text\/html" data="\/demo"[^>]*><\/object>/);
  // Painting order, bottom to top: the diagram, the still frame, the demo. A failed <object> is empty, so the layers show.
  assert.ok(html.indexOf('class="stage-static"') < html.indexOf('class="stage-still"'));
  assert.ok(html.indexOf('class="stage-still"') < html.indexOf("<object"));
  assert.match(html, /<svg class="diagram"/);
  assert.match(html, /\.stage-still \{[^}]*url\("\/hero-[0-9a-f]{10}\.jpg"\)/);
  assert.ok(!/<video/i.test(html), "the live hero downloads no video; the demo page loads it only if it must");
  assert.match(html, /href="\/\?hero=video"/);
  assert.match(html, /href="\/\?hero=static"/);
  const csp = response.headers["content-security-policy"] as string;
  for (const part of ["default-src 'none'", "media-src 'self'", "img-src data: 'self'", "object-src 'self'", "frame-src 'self'", "frame-ancestors 'none'"]) assert.ok(csp.includes(part), part);
  assert.ok(!/script-src|connect-src/.test(csp), "the landing page itself still has no scripts");
  assert.ok(!/<script/i.test(html));
  await app.close();
});

test("the video hero is the first backout: a video over the still, over the diagram", async () => {
  const app = buildTestApp(testBroker());
  const html = (await heroPage(app, "?hero=video")).body;
  const video = html.match(/<video[^>]*>.*?<\/video>/s)?.[0] ?? "";
  for (const attribute of ["autoplay", "muted", "loop", "playsinline"]) assert.match(video, new RegExp(`\\b${attribute}\\b`));
  assert.ok(!/\bcontrols\b/.test(video), "controls would paint over the fallback layers when the video fails");
  assert.match(video, /<source src="\/hero-[0-9a-f]{10}\.mp4" type="video\/mp4">/);
  assert.ok(html.indexOf('class="stage-static"') < html.indexOf('class="stage-still"'));
  assert.ok(html.indexOf('class="stage-still"') < html.indexOf("<video"));
  assert.ok(!/<object/i.test(html));
  assert.match(html, /prefers-reduced-motion: reduce\) \{ \.stage-video \{ display: none; \}/);
  await app.close();
});

test("the static hero is the full backout: ?hero=static and AP_HERO=static drop the demo and the video", async () => {
  const app = buildTestApp(testBroker());
  const bodies = [(await heroPage(app, "?hero=static")).body];
  const previous = process.env.AP_HERO;
  try {
    process.env.AP_HERO = "static";
    bodies.push((await heroPage(app)).body);
    process.env.AP_HERO = " STATIC ";
    bodies.push((await heroPage(app)).body);
    for (const html of bodies) {
      assert.ok(!/<video|<object|<source/i.test(html), "no demo and no video in the markup");
      assert.ok(html.includes("<h1>Give a private application a public HTTPS URL.</h1>"));
      assert.match(html, /<svg class="mark"[^>]*width="132"/, "the original mark");
      assert.match(html, /<svg class="diagram"/);
    }
    // The environment picks the default; a query still overrides it, and unknown values mean the live hero.
    assert.match((await heroPage(app, "?hero=video")).body, /<video/);
    assert.match((await heroPage(app, "?hero=live")).body, /<object/);
    assert.match((await heroPage(app, "?hero=bogus")).body, /<h1>/);
    process.env.AP_HERO = "video";
    assert.match((await heroPage(app)).body, /<video/);
    process.env.AP_HERO = "nonsense";
    assert.match((await heroPage(app)).body, /<object/);
    delete process.env.AP_HERO;
    assert.match((await heroPage(app)).body, /<object/);
  } finally {
    if (previous === undefined) delete process.env.AP_HERO;
    else process.env.AP_HERO = previous;
  }
  await app.close();
});

test("the demo page is the only page with a script, and only AP's own", async () => {
  const app = buildTestApp(testBroker());
  const response = await app.inject({ method: "GET", url: "/demo" });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["content-type"]), /^text\/html; charset=utf-8/);
  const csp = response.headers["content-security-policy"] as string;
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self' blob:/);
  assert.match(csp, /frame-ancestors 'self'/, "the landing page may frame it; no other origin");
  assert.ok(!/https?:/.test(csp), "no other origin is allowed anything");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  const html = response.body;
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /^\/demo-assets\/index-[A-Za-z0-9_-]{8}\.js$/);
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), "no inline script");
  assert.ok(!/(?:src|href)="https?:/i.test(html), "no external resources");
  // The page learns where the hero media is from the server, because the files carry content hashes in their names.
  assert.match(html, /<meta name="ap-hero-video" content="\/hero-[0-9a-f]{10}\.mp4">/);
  assert.match(html, /<meta name="ap-hero-poster" content="\/hero-[0-9a-f]{10}\.jpg">/);
  await app.close();
});

test("the demo's files are served gzipped to browsers that accept it and decoded to those that do not", async () => {
  const app = buildTestApp(testBroker());
  const html = (await app.inject({ method: "GET", url: "/demo" })).body;
  const script = html.match(/src="(\/demo-assets\/[^"]+\.js)"/)![1];
  const style = html.match(/href="(\/demo-assets\/[^"]+\.css)"/)![1];

  const gzipped = await app.inject({ method: "GET", url: script, headers: { "accept-encoding": "gzip, deflate, br" } });
  assert.equal(gzipped.statusCode, 200);
  assert.equal(gzipped.headers["content-encoding"], "gzip");
  assert.match(String(gzipped.headers["content-type"]), /^text\/javascript/);
  assert.match(String(gzipped.headers["cache-control"]), /immutable/);
  assert.equal(gzipped.headers.vary, "accept-encoding");

  const plain = await app.inject({ method: "GET", url: script, headers: { "accept-encoding": "identity" } });
  assert.equal(plain.statusCode, 200);
  assert.equal(plain.headers["content-encoding"], undefined);
  assert.ok(plain.rawPayload.length > gzipped.rawPayload.length * 2, "decoded is larger than gzipped");
  assert.ok(plain.body.includes("three") || plain.rawPayload.length > 100_000, "it is the real bundle");

  assert.match(String((await app.inject({ method: "GET", url: style, headers: { "accept-encoding": "gzip" } })).headers["content-type"]), /^text\/css/);
  const font = html.match(/\/demo-assets\/[^"']+\.woff2/)?.[0];
  if (font) assert.equal((await app.inject({ method: "GET", url: font })).headers["content-type"], "font/woff2");

  for (const missing of ["/demo-assets/nope.js", "/demo-assets/index.html", "/demo-assets/__proto__", "/demo-assets/constructor"]) {
    assert.equal((await app.inject({ method: "GET", url: missing })).statusCode, 404, missing);
  }
  await app.close();
});

test("the hero media is served with Range support so Safari can play it", async () => {
  const app = buildTestApp(testBroker());
  const html = (await heroPage(app, "?hero=video")).body;
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

test("channel hostnames never serve the demo or the hero media either", async () => {
  await withBaseDomain("apchannels.test", async () => {
    const app = buildTestApp(testBroker());
    const own = { host: "apchannels.test" };
    const html = (await heroPage(app, "?hero=video", own)).body;
    const videoPath = html.match(/<source src="([^"]+)"/)![1];
    const demo = await app.inject({ method: "GET", url: "/demo", headers: own });
    const script = demo.body.match(/src="(\/demo-assets\/[^"]+\.js)"/)![1];
    for (const url of [videoPath, "/demo", script]) {
      assert.equal((await app.inject({ method: "GET", url, headers: own })).statusCode, 200, `${url} on AP's own host`);
      const response = await app.inject({ method: "GET", url, headers: { host: `${channel}.apchannels.test` } });
      assert.equal(response.statusCode, 404, `${url} on a channel host`);
      assert.deepEqual(response.json(), { error: "not_found" });
    }
    await app.close();
  });
});

async function withGa<T>(value: string | undefined, run: () => Promise<T>) {
  const previous = process.env.AP_GA_ID;
  if (value === undefined) delete process.env.AP_GA_ID; else process.env.AP_GA_ID = value;
  try { return await run(); } finally { if (previous === undefined) delete process.env.AP_GA_ID; else process.env.AP_GA_ID = previous; }
}

test("without AP_GA_ID the pages have no analytics, no banner and the unchanged CSP", async () => {
  await withGa(undefined, async () => {
    const app = buildTestApp(testBroker());
    for (const url of ["/", "/privacy"]) {
      const response = await app.inject({ method: "GET", url });
      assert.ok(!/<script|id="consent"|consent\.js|googletagmanager/i.test(response.body), url);
      assert.ok(!response.headers["content-security-policy"]!.toString().includes("script-src"));
    }
    assert.match((await app.inject({ method: "GET", url: "/privacy" })).body, /No tracking/);
    assert.equal((await app.inject({ method: "GET", url: "/consent.js" })).statusCode, 404);
    await app.close();
  });
});

test("an invalid AP_GA_ID leaves analytics off", async () => {
  await withGa("G-<script>", async () => {
    const app = buildTestApp(testBroker());
    assert.ok(!(await app.inject({ method: "GET", url: "/" })).body.includes("consent.js"));
    await app.close();
  });
});

test("with AP_GA_ID the website pages get a consent banner, a same-origin script and a CSP that allows Google", async () => {
  await withGa("G-NBRMBDPL80", async () => {
    const app = buildTestApp(testBroker());
    for (const url of ["/", "/privacy"]) {
      const response = await app.inject({ method: "GET", url });
      const csp = response.headers["content-security-policy"]!.toString();
      assert.match(response.body, /<div id="consent" role="dialog"[^>]* hidden>/);
      assert.match(response.body, /<script src="\/consent\.js" data-ga="G-NBRMBDPL80" defer><\/script>/);
      assert.ok(!/<script(?![^>]* src=)/.test(response.body), "no inline script");
      assert.ok(!response.body.includes("googletagmanager"), "Google is not referenced before consent");
      assert.match(csp, /script-src 'self' https:\/\/www\.googletagmanager\.com/);
      assert.match(csp, /connect-src https:\/\/\*\.google-analytics\.com/);
      assert.match(csp, /default-src 'none'/);
    }
    const privacy = (await app.inject({ method: "GET", url: "/privacy" })).body;
    assert.match(privacy, /Analytics only if you opt in/);
    assert.ok(!privacy.includes("No tracking"));
    const script = await app.inject({ method: "GET", url: "/consent.js" });
    assert.equal(script.statusCode, 200);
    assert.match(script.headers["content-type"]!.toString(), /javascript/);
    // analytics_storage starts denied and the tag is only added after Accept
    assert.match(script.body, /analytics_storage: "denied"/);
    assert.match(script.body, /allow_google_signals: false/);
    // the embedded demo and the media never carry analytics
    const demo = await app.inject({ method: "GET", url: "/demo" });
    assert.ok(!demo.body.includes("consent.js") && !demo.headers["content-security-policy"]!.toString().includes("googletagmanager"));
    await app.close();
  });
});

test("the consent script loads Google only after Accept and stops it after Decline", async () => {
  const { CONSENT_SCRIPT } = await import("../src/site.js");
  const vm = await import("node:vm");
  const run = (saved: string | null) => {
    const loaded: string[] = [];
    const clicks: Array<(event: unknown) => void> = [];
    const banner = { hidden: true, addEventListener: (_: string, fn: (event: unknown) => void) => clicks.push(fn) };
    const storage = new Map<string, string>(saved ? [["ap-consent", saved]] : []);
    const context: Record<string, unknown> = {
      document: {
        currentScript: { getAttribute: () => "G-NBRMBDPL80" },
        getElementById: () => banner, querySelector: () => null, cookie: "",
        head: { appendChild: (el: { src: string }) => loaded.push(el.src) },
        createElement: () => ({}),
      },
      localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) },
      location: { hostname: "apchannels.dev" },
      encodeURIComponent,
    };
    context.window = context;
    vm.runInNewContext(CONSENT_SCRIPT, context);
    const click = (value: string) => clicks[0]({ target: { getAttribute: () => value } });
    return { loaded, banner, storage, click, context };
  };

  const fresh = run(null);
  assert.equal(fresh.banner.hidden, false, "asks first");
  assert.deepEqual(fresh.loaded, [], "nothing loads before a choice");
  fresh.click("granted");
  assert.equal(fresh.storage.get("ap-consent"), "granted");
  assert.equal(fresh.banner.hidden, true);
  assert.deepEqual(fresh.loaded, ["https://www.googletagmanager.com/gtag/js?id=G-NBRMBDPL80"]);

  const declined = run(null);
  declined.click("denied");
  assert.deepEqual(declined.loaded, []);
  assert.equal(declined.context["ga-disable-G-NBRMBDPL80"], true);

  const remembered = run("denied");
  assert.equal(remembered.banner.hidden, true);
  assert.deepEqual(remembered.loaded, []);
  assert.equal(run("granted").loaded.length, 1, "a saved Accept loads it without asking again");
});
