import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { DeviceTokenResult, GitHubDeviceClient } from "../src/github.js";
import { FetchGoogleDeviceClient, GoogleError, GoogleUnverifiedEmailError, googleClientFromEnv, type GoogleDeviceClient } from "../src/google.js";
import { buildTestApp } from "./build-test-app.js";
import { testBroker } from "./test-broker.js";

function fakeProvider(userCode: string, url: string, user: { id: string; login: string }) {
  const fake = {
    user,
    results: [] as DeviceTokenResult[],
    polls: 0,
    failUser: undefined as Error | undefined,
    client: undefined as unknown as GitHubDeviceClient & GoogleDeviceClient,
  };
  fake.client = {
    startDevice: async () => ({ deviceCode: `dc-${randomUUID()}`, userCode, verificationUri: url, expiresIn: 1800, interval: 0 }),
    pollToken: async () => {
      fake.polls += 1;
      return fake.results.shift() ?? { status: "pending" };
    },
    user: async () => {
      if (fake.failUser) throw fake.failUser;
      return fake.user;
    },
  };
  return fake;
}

function setup(options: { github?: boolean; google?: boolean } = { github: true, google: true }) {
  const github = fakeProvider("GH-1234", "https://github.com/login/device", { id: "1001", login: "octo" });
  const google = fakeProvider("GG-5678", "https://www.google.com/device", { id: "google:110248495921238986420", login: "ada@example.com" });
  const app = buildTestApp(testBroker(), {
    ...(options.github ? { github: github.client } : {}),
    ...(options.google ? { google: google.client } : {}),
  });
  const start = (payload?: unknown) => app.inject({ method: "POST", url: "/auth/device", ...(payload === undefined ? {} : { payload: payload as object }) });
  const poll = (payload: object) => app.inject({ method: "POST", url: "/auth/device/token", payload });
  return { app, github, google, start, poll };
}

async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>) {
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const noProviders = { AP_GITHUB_CLIENT_ID: undefined, AP_GOOGLE_CLIENT_ID: undefined, AP_GOOGLE_CLIENT_SECRET: undefined };

test("google sign-in starts with the Google code and url", async () => {
  await withEnv(noProviders, async () => {
    const { app, start } = setup();
    const started = await start({ provider: "google" });
    assert.equal(started.statusCode, 201);
    assert.equal(started.json().code, "GG-5678");
    assert.equal(started.json().url, "https://www.google.com/device");
    assert.match(started.json().deviceId, /^apd_/);
    await app.close();
  });
});

test("google sign-in waits on pending and slow_down, then hands out a key for google:<sub>", async () => {
  await withEnv({ ...noProviders, AP_ADMIN_TOKEN: "admin-secret" }, async () => {
    const { app, google, start, poll } = setup();
    const { deviceId } = (await start({ provider: "google" })).json();
    google.results.push({ status: "pending" });
    const pending = await poll({ deviceId, provider: "google" });
    assert.equal(pending.statusCode, 202);
    assert.deepEqual(pending.json(), { status: "waiting", interval: 0 });

    google.results.push({ status: "slow_down", interval: 10 });
    const slow = await poll({ deviceId, provider: "google" });
    assert.equal(slow.statusCode, 202);
    assert.equal(slow.json().interval, 10);

    // The stored interval now rate-limits polls without reaching Google.
    const polls = google.polls;
    assert.equal((await poll({ deviceId, provider: "google" })).statusCode, 202);
    assert.equal(google.polls, polls);
    await app.close();
  });
});

test("approved google sign-in creates a separate google account", async () => {
  await withEnv({ ...noProviders, AP_ADMIN_TOKEN: "admin-secret" }, async () => {
    const { app, github, google, start, poll } = setup();
    google.results.push({ status: "approved", accessToken: "ya29.test" });
    const { deviceId } = (await start({ provider: "google" })).json();
    const done = await poll({ deviceId, provider: "google", label: "laptop" });
    assert.equal(done.statusCode, 201, done.body);
    assert.match(done.json().key, /^apk_/);
    assert.equal(done.json().login, "ada@example.com");

    // Same person on GitHub is a different account.
    github.results.push({ status: "approved", accessToken: "gho_test" });
    const gh = await start();
    assert.equal((await poll({ deviceId: gh.json().deviceId })).statusCode, 201);

    const admin = { authorization: "Bearer admin-secret" };
    const accounts = (await app.inject({ method: "GET", url: "/admin/accounts", headers: admin })).json().accounts as { githubId: string; login: string }[];
    assert.deepEqual(accounts.map((account) => account.githubId).sort(), ["1001", "google:110248495921238986420"]);

    const keys = await app.inject({ method: "GET", url: "/keys", headers: { "x-ap-key": done.json().key } });
    assert.equal(keys.json().login, "ada@example.com");
    await app.close();
  });
});

test("expired and denied google sign-ins use the existing error codes", async () => {
  await withEnv(noProviders, async () => {
    const { app, google, start, poll } = setup();
    for (const [result, status, error] of [[{ status: "expired" }, 400, "sign_in_expired"], [{ status: "denied" }, 403, "sign_in_denied"]] as const) {
      google.results.push(result);
      const { deviceId } = (await start({ provider: "google" })).json();
      const response = await poll({ deviceId, provider: "google" });
      assert.equal(response.statusCode, status);
      assert.deepEqual(response.json(), { error });
    }
    await app.close();
  });
});

test("an unverified google email is refused and no account is created", async () => {
  await withEnv({ ...noProviders, AP_ADMIN_TOKEN: "admin-secret" }, async () => {
    const { app, google, start, poll } = setup();
    google.results.push({ status: "approved", accessToken: "ya29.test" });
    google.failUser = new GoogleUnverifiedEmailError();
    const { deviceId } = (await start({ provider: "google" })).json();
    const response = await poll({ deviceId, provider: "google" });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: "sign_in_denied" });
    const accounts = await app.inject({ method: "GET", url: "/admin/accounts", headers: { authorization: "Bearer admin-secret" } });
    assert.deepEqual(accounts.json().accounts, []);
    await app.close();
  });
});

test("a google outage answers 502 google_error", async () => {
  await withEnv(noProviders, async () => {
    const { app, google, start, poll } = setup();
    google.results.push({ status: "approved", accessToken: "ya29.test" });
    google.failUser = new GoogleError("GOOGLE_HTTP_500");
    const { deviceId } = (await start({ provider: "google" })).json();
    const response = await poll({ deviceId, provider: "google" });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.json(), { error: "google_error" });
    await app.close();
  });
});

test("a provider that is not configured answers 503 on both steps", async () => {
  await withEnv(noProviders, async () => {
    const { app, start, poll } = setup({ github: true });
    for (const response of [await start({ provider: "google" }), await poll({ deviceId: "apd_x", provider: "google" })]) {
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.json(), { error: "sign_in_not_configured" });
    }
    const googleOnly = setup({ google: true });
    const github = await googleOnly.start({ provider: "github" });
    assert.equal(github.statusCode, 503);
    assert.deepEqual(github.json(), { error: "sign_in_not_configured" });
    // With no provider named, the default is GitHub.
    assert.equal((await googleOnly.start()).statusCode, 503);
    await app.close();
    await googleOnly.app.close();
  });
});

test("Google needs both its client id and secret to be on", async () => {
  await withEnv({ AP_GOOGLE_CLIENT_ID: "id", AP_GOOGLE_CLIENT_SECRET: undefined }, async () => {
    assert.equal(googleClientFromEnv(), undefined);
    process.env.AP_GOOGLE_CLIENT_SECRET = "secret";
    assert.ok(googleClientFromEnv());
    process.env.AP_GOOGLE_CLIENT_ID = " ";
    assert.equal(googleClientFromEnv(), undefined);
  });
});

test("an unknown provider is a 400 on both steps", async () => {
  await withEnv(noProviders, async () => {
    const { app, start, poll } = setup();
    for (const provider of ["gitlab", "", null, 7, ["google"]]) {
      for (const response of [await start({ provider }), await poll({ deviceId: "apd_x", provider })]) {
        assert.equal(response.statusCode, 400);
        assert.deepEqual(response.json(), { error: "unknown_provider" });
      }
    }
    await app.close();
  });
});

test("polling with a provider that disagrees with the stored one is refused without polling", async () => {
  await withEnv(noProviders, async () => {
    const { app, github, google, start, poll } = setup();
    github.results.push({ status: "approved", accessToken: "gho_test" });
    const { deviceId } = (await start({ provider: "google" })).json();
    const mismatch = await poll({ deviceId, provider: "github" });
    assert.equal(mismatch.statusCode, 400);
    assert.deepEqual(mismatch.json(), { error: "provider_mismatch" });
    assert.equal(github.polls, 0);
    assert.equal(google.polls, 0);

    // The login is still alive for the right provider, and a poll that names none follows the stored one.
    google.results.push({ status: "approved", accessToken: "ya29.test" });
    assert.equal((await poll({ deviceId })).statusCode, 201);
    assert.equal(github.polls, 0);

    // A GitHub login cannot be finished as Google either.
    const gh = (await start()).json();
    assert.equal((await poll({ deviceId: gh.deviceId, provider: "google" })).json().error, "provider_mismatch");
    await app.close();
  });
});

test("requests without a provider still sign in with GitHub, as Loom sends them", async () => {
  await withEnv(noProviders, async () => {
    const { app, github, google, start, poll } = setup();
    github.results.push({ status: "approved", accessToken: "gho_test" });
    const started = await start();
    assert.equal(started.statusCode, 201);
    assert.equal(started.json().code, "GH-1234");
    assert.equal(started.json().url, "https://github.com/login/device");
    const done = await poll({ deviceId: started.json().deviceId });
    assert.equal(done.statusCode, 201);
    assert.equal(done.json().login, "octo");
    assert.equal(google.polls, 0);

    const explicit = await start({ provider: "github" });
    assert.equal(explicit.json().code, "GH-1234");
    await app.close();
  });
});

test("a device login saved before providers existed is polled as GitHub", async () => {
  await withEnv(noProviders, async () => {
    const broker = testBroker();
    const github = fakeProvider("GH-1234", "https://github.com/login/device", { id: "1001", login: "octo" });
    const app = buildTestApp(broker, { github: github.client });
    const deviceId = `apd_${"a".repeat(32)}`;
    await broker.accounts.saveDeviceLogin(deviceId, { deviceCode: "dc", interval: 0, expiresAt: Date.now() + 60_000, nextPollAt: 0 });
    github.results.push({ status: "approved", accessToken: "gho_test" });
    assert.equal((await app.inject({ method: "POST", url: "/auth/device/token", payload: { deviceId } })).statusCode, 201);
    await app.close();
  });
});

test("admin routes accept google: ids and reject anything else before reaching the store", async () => {
  await withEnv({ ...noProviders, AP_ADMIN_TOKEN: "admin-secret" }, async () => {
    const { app, google, start, poll } = setup();
    google.results.push({ status: "approved", accessToken: "ya29.test" });
    const { deviceId } = (await start({ provider: "google" })).json();
    const { key } = (await poll({ deviceId, provider: "google" })).json();
    const admin = { authorization: "Bearer admin-secret" };
    const id = "google:110248495921238986420";

    const usage = await app.inject({ method: "GET", url: `/admin/accounts/${id}`, headers: admin });
    assert.equal(usage.statusCode, 200, usage.body);
    assert.equal(usage.json().account.githubId, id);
    assert.equal(usage.json().keys.length, 1);

    assert.equal((await app.inject({ method: "POST", url: `/admin/accounts/${id}/disable`, headers: admin })).statusCode, 204);
    assert.equal((await app.inject({ method: "GET", url: "/keys", headers: { "x-ap-key": key } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: `/admin/accounts/${id}/enable`, headers: admin })).statusCode, 204);
    assert.equal((await app.inject({ method: "GET", url: "/admin/accounts/google:999", headers: admin })).statusCode, 404);

    // Malformed ids never reach the store, so they cannot probe other Redis keys or forge log lines.
    for (const bad of ["google:", "google:abc", "google:1:2", "Google:1", "gitlab:1", "google:1%0Aevent", "google:%0d%0a1", "1:2", "google:" + "9".repeat(41), "9".repeat(21), "google:1%20"]) {
      for (const [method, suffix] of [["GET", ""], ["POST", "/disable"], ["POST", "/enable"]] as const) {
        const response = await app.inject({ method, url: `/admin/accounts/${bad}${suffix}`, headers: admin });
        assert.equal(response.statusCode, 404, `${method} ${bad}${suffix}`);
        assert.deepEqual(response.json(), { error: "account_not_found" });
      }
    }
    await app.close();
  });
});

test("the google client sends the secret to Google only and maps its answers", async () => {
  const calls: { url: string; body: URLSearchParams; headers: Record<string, string> }[] = [];
  const answers: { status?: number; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: new URLSearchParams(String(init.body ?? "")), headers: (init.headers ?? {}) as Record<string, string> });
    const answer = answers.shift() ?? { body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
  const client = new FetchGoogleDeviceClient("client-id", "client-secret", fetchImpl);

  answers.push({ body: { device_code: "dc", user_code: "ABCD-EFGH", verification_url: "https://www.google.com/device", expires_in: 1800, interval: 5 } });
  assert.deepEqual(await client.startDevice(), { deviceCode: "dc", userCode: "ABCD-EFGH", verificationUri: "https://www.google.com/device", expiresIn: 1800, interval: 5 });
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/device/code");
  assert.equal(calls[0].body.get("scope"), "openid email");
  assert.equal(calls[0].body.get("client_secret"), null);

  const expected: [unknown, unknown][] = [
    [{ error: "authorization_pending" }, { status: "pending" }],
    [{ error: "slow_down" }, { status: "slow_down", interval: 10 }],
    [{ error: "expired_token" }, { status: "expired" }],
    [{ error: "access_denied" }, { status: "denied" }],
    [{ access_token: "ya29.x", id_token: "ignored" }, { status: "approved", accessToken: "ya29.x" }],
  ];
  for (const [body, result] of expected) {
    answers.push({ status: 428, body });
    assert.deepEqual(await client.pollToken("dc"), result);
  }
  const tokenCall = calls[1];
  assert.equal(tokenCall.url, "https://oauth2.googleapis.com/token");
  assert.equal(tokenCall.body.get("client_secret"), "client-secret");
  assert.equal(tokenCall.body.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");

  // An unexpected or hostile error string never reaches the error message.
  answers.push({ status: 400, body: { error: "bad\nline client-secret" } });
  await assert.rejects(client.pollToken("dc"), (error: Error) => error instanceof GoogleError && error.message === "GOOGLE_BAD_TOKEN_RESPONSE");
  answers.push({ status: 400, body: { error: "invalid_client" } });
  await assert.rejects(client.pollToken("dc"), (error: Error) => error.message === "GOOGLE_INVALID_CLIENT" && !error.message.includes("client-secret"));
});

test("the google client identifies the user by sub and rejects unverified or malformed profiles", async () => {
  const answers: { status?: number; body: unknown }[] = [];
  const seen: Record<string, string>[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    seen.push(init.headers as Record<string, string>);
    const answer = answers.shift()!;
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
  const client = new FetchGoogleDeviceClient("client-id", "client-secret", fetchImpl);

  answers.push({ body: { sub: "110248495921238986420", email: "ada@example.com", email_verified: true } });
  assert.deepEqual(await client.user("ya29.x"), { id: "google:110248495921238986420", login: "ada@example.com" });
  assert.equal(seen[0].authorization, "Bearer ya29.x");

  answers.push({ body: { sub: "1", email: "ada@example.com", email_verified: false } });
  await assert.rejects(client.user("t"), GoogleUnverifiedEmailError);
  answers.push({ body: { sub: "1", email: "ada@example.com" } });
  await assert.rejects(client.user("t"), GoogleUnverifiedEmailError);

  for (const body of [
    { sub: "not-digits", email: "a@b.c", email_verified: true },
    { sub: "1\n2", email: "a@b.c", email_verified: true },
    { sub: 12, email: "a@b.c", email_verified: true },
    { sub: "1", email: "a@b.c\nforged", email_verified: true },
    { sub: "1", email_verified: true },
  ]) {
    answers.push({ body });
    await assert.rejects(client.user("t"), GoogleError);
  }
  answers.push({ status: 401, body: { error: "invalid_token" } });
  await assert.rejects(client.user("t"), (error: Error) => error.message === "GOOGLE_HTTP_401");
});
