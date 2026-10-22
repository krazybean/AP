import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { DeviceTokenResult, GitHubDeviceClient, GitHubUser } from "../src/github.js";
import { buildTestApp } from "./build-test-app.js";
import { testBroker } from "./test-broker.js";

function fakeGitHub() {
  const fake = {
    user: { id: "1001", login: "octo" } as GitHubUser,
    results: [] as DeviceTokenResult[],
    polls: 0,
    interval: 0,
    client: undefined as unknown as GitHubDeviceClient,
  };
  fake.client = {
    startDevice: async () => ({ deviceCode: `dc-${randomUUID()}`, userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: fake.interval }),
    pollToken: async () => {
      fake.polls += 1;
      return fake.results.shift() ?? { status: "pending" };
    },
    user: async () => fake.user,
  };
  return fake;
}

function setup() {
  const github = fakeGitHub();
  const app = buildTestApp(testBroker(), { github: github.client });
  async function signIn(user: GitHubUser = { id: "1001", login: "octo" }) {
    github.user = user;
    github.results.push({ status: "approved", accessToken: "gho_test" });
    const started = await app.inject({ method: "POST", url: "/auth/device" });
    assert.equal(started.statusCode, 201);
    const finished = await app.inject({ method: "POST", url: "/auth/device/token", payload: { deviceId: started.json().deviceId } });
    assert.equal(finished.statusCode, 201, finished.body);
    return finished.json() as { key: string; keyId: string; login: string };
  }
  async function createChannel(key?: string) {
    return app.inject({ method: "POST", url: "/channels", headers: key ? { "x-ap-key": key } : {} });
  }
  // Answering an unknown request id reaches the broker only after the account checks pass.
  async function respond(channel: string, secret: string, key?: string) {
    return app.inject({
      method: "POST",
      url: `/channels/${channel}/responses/${randomUUID()}`,
      headers: { authorization: `Bearer ${secret}`, ...(key ? { "x-ap-key": key } : {}) },
      payload: { statusCode: 200, body: {} },
    });
  }
  return { app, github, signIn, createChannel, respond };
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

test("sign-in answers 503 when no GitHub client id is configured", async () => {
  await withEnv({ AP_GITHUB_CLIENT_ID: undefined }, async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: "POST", url: "/auth/device" });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: "sign_in_not_configured" });
    await app.close();
  });
});

test("device sign-in returns a code, waits for approval, then hands out one key", async () => {
  const { app, github } = setup();
  const started = await app.inject({ method: "POST", url: "/auth/device" });
  assert.equal(started.statusCode, 201);
  const body = started.json();
  assert.equal(body.code, "ABCD-1234");
  assert.equal(body.url, "https://github.com/login/device");
  assert.match(body.deviceId, /^apd_/);

  const waiting = await app.inject({ method: "POST", url: "/auth/device/token", payload: { deviceId: body.deviceId } });
  assert.equal(waiting.statusCode, 202);
  assert.equal(waiting.json().status, "waiting");

  github.results.push({ status: "approved", accessToken: "gho_test" });
  const done = await app.inject({ method: "POST", url: "/auth/device/token", payload: { deviceId: body.deviceId, label: "laptop" } });
  assert.equal(done.statusCode, 201);
  assert.match(done.json().key, /^apk_[A-Za-z0-9_-]{43}$/);
  assert.equal(done.json().login, "octo");

  const again = await app.inject({ method: "POST", url: "/auth/device/token", payload: { deviceId: body.deviceId } });
  assert.equal(again.statusCode, 400);
  assert.deepEqual(again.json(), { error: "sign_in_expired" });
  await app.close();
});

test("polls faster than GitHub's interval are answered without calling GitHub", async () => {
  const { app, github } = setup();
  github.interval = 5;
  const started = await app.inject({ method: "POST", url: "/auth/device" });
  const poll = await app.inject({ method: "POST", url: "/auth/device/token", payload: { deviceId: started.json().deviceId } });
  assert.equal(poll.statusCode, 202);
  assert.equal(poll.json().interval, 5);
  assert.equal(github.polls, 0);
  await app.close();
});

test("a denied or expired sign-in ends the login", async () => {
  const { app, github } = setup();
  for (const [result, status, error] of [[{ status: "denied" }, 403, "sign_in_denied"], [{ status: "expired" }, 400, "sign_in_expired"]] as const) {
    github.results.push(result);
    const started = await app.inject({ method: "POST", url: "/auth/device" });
    const response = await app.inject({ method: "POST", url: "/auth/device/token", payload: { deviceId: started.json().deviceId } });
    assert.equal(response.statusCode, status);
    assert.deepEqual(response.json(), { error });
  }
  const bogus = await app.inject({ method: "POST", url: "/auth/device/token", payload: { deviceId: "apd_nope" } });
  assert.equal(bogus.statusCode, 400);
  await app.close();
});

test("with accounts optional, anonymous use works and keys still own their channels", async () => {
  await withEnv({ AP_REQUIRE_ACCOUNT: undefined }, async () => {
    const { app, signIn, createChannel, respond } = setup();
    const anonymous = await createChannel();
    assert.equal(anonymous.statusCode, 201);
    assert.equal((await respond(anonymous.json().channel, anonymous.json().secret)).statusCode, 404);

    const octo = await signIn();
    const other = await signIn({ id: "2002", login: "hubot" });
    const owned = (await createChannel(octo.key)).json();
    assert.equal((await respond(owned.channel, owned.secret, octo.key)).statusCode, 404);
    assert.equal((await respond(owned.channel, owned.secret)).statusCode, 404);
    const stolen = await respond(owned.channel, owned.secret, other.key);
    assert.equal(stolen.statusCode, 403);
    assert.deepEqual(stolen.json(), { error: "channel_not_owned" });

    const invalid = await createChannel("apk_not-a-real-key");
    assert.equal(invalid.statusCode, 401);
    assert.deepEqual(invalid.json(), { error: "account_key_invalid" });
    await app.close();
  });
});

test("with accounts required, every management and downstream call needs the owner's key", async () => {
  const { app, signIn, createChannel, respond } = setup();
  const unowned = (await createChannel()).json();
  const octo = await signIn();
  const other = await signIn({ id: "2002", login: "hubot" });
  await withEnv({ AP_REQUIRE_ACCOUNT: "true" }, async () => {
    const missing = await createChannel();
    assert.equal(missing.statusCode, 401);
    assert.deepEqual(missing.json(), { error: "account_required" });

    const owned = (await createChannel(octo.key)).json();
    assert.equal((await respond(owned.channel, owned.secret)).statusCode, 401);
    assert.equal((await respond(owned.channel, owned.secret, other.key)).statusCode, 403);
    assert.equal((await respond(unowned.channel, unowned.secret, octo.key)).statusCode, 403);
    const gone = await respond(randomUUID(), "secret", octo.key);
    assert.equal(gone.statusCode, 404);
    assert.deepEqual(gone.json(), { error: "channel_not_found" });

    // Client traffic and health stay key-free; the key is never forwarded to the app.
    const client = app.inject({ method: "GET", url: `/c/${owned.channel}/hi`, headers: { "x-ap-key": octo.key } });
    const next = await app.inject({ method: "GET", url: `/channels/${owned.channel}/next`, headers: { authorization: `Bearer ${owned.secret}`, "x-ap-key": octo.key } });
    assert.equal(next.statusCode, 200);
    assert.equal(next.json().headers["x-ap-key"], undefined);
    await app.inject({ method: "POST", url: `/channels/${owned.channel}/responses/${next.json().id}`, headers: { authorization: `Bearer ${owned.secret}`, "x-ap-key": octo.key }, payload: { statusCode: 200, body: { ok: true } } });
    assert.deepEqual((await client).json(), { ok: true });
    assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
  });
  await app.close();
});

test("an account can hold only its live-channel limit at once", async () => {
  await withEnv({ AP_ACCOUNT_CHANNEL_LIMIT: "2" }, async () => {
    const { app, signIn, createChannel } = setup();
    const octo = await signIn();
    assert.equal((await createChannel(octo.key)).statusCode, 201);
    assert.equal((await createChannel(octo.key)).statusCode, 201);
    const third = await createChannel(octo.key);
    assert.equal(third.statusCode, 429);
    assert.deepEqual(third.json(), { error: "account_channel_limit" });
    assert.equal((await createChannel()).statusCode, 201);
    await app.close();
  });
});

test("keys can be listed and revoked by their owner", async () => {
  const { app, signIn, createChannel } = setup();
  const first = await signIn();
  const second = await signIn();
  const listed = await app.inject({ method: "GET", url: "/keys", headers: { "x-ap-key": first.key } });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().login, "octo");
  assert.deepEqual(listed.json().keys.map((key: { keyId: string; current: boolean }) => [key.keyId, key.current]), [[first.keyId, true], [second.keyId, false]]);
  assert.equal(JSON.stringify(listed.json()).includes(first.key), false);

  assert.equal((await app.inject({ method: "GET", url: "/keys" })).statusCode, 401);
  const revoked = await app.inject({ method: "DELETE", url: `/keys/${second.keyId}`, headers: { "x-ap-key": first.key } });
  assert.equal(revoked.statusCode, 204);
  assert.equal((await createChannel(second.key)).statusCode, 401);
  assert.equal((await app.inject({ method: "DELETE", url: `/keys/${second.keyId}`, headers: { "x-ap-key": first.key } })).statusCode, 404);
  await app.close();
});

test("admin routes are hidden without the token and can disable an account", async () => {
  await withEnv({ AP_ADMIN_TOKEN: "admin-secret" }, async () => {
    const { app, signIn, createChannel, github } = setup();
    const octo = await signIn();
    await createChannel(octo.key);
    const admin = { authorization: "Bearer admin-secret" };
    assert.equal((await app.inject({ method: "GET", url: "/admin/accounts" })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: "/admin/accounts", headers: { authorization: "Bearer wrong" } })).statusCode, 404);

    const accounts = await app.inject({ method: "GET", url: "/admin/accounts", headers: admin });
    assert.deepEqual(accounts.json().accounts.map((account: { login: string }) => account.login), ["octo"]);
    const usage = (await app.inject({ method: "GET", url: "/admin/accounts/1001", headers: admin })).json();
    assert.equal(usage.liveChannels.length, 1);
    assert.equal(Object.values(usage.channelsCreatedByDay as Record<string, number>).reduce((a, b) => a + b, 0), 1);
    assert.equal(usage.keys.length, 1);

    assert.equal((await app.inject({ method: "POST", url: "/admin/accounts/1001/disable", headers: admin })).statusCode, 204);
    assert.equal((await createChannel(octo.key)).statusCode, 401);
    github.results.push({ status: "approved", accessToken: "gho_test" });
    const started = await app.inject({ method: "POST", url: "/auth/device" });
    const blocked = await app.inject({ method: "POST", url: "/auth/device/token", payload: { deviceId: started.json().deviceId } });
    assert.equal(blocked.statusCode, 403);
    assert.deepEqual(blocked.json(), { error: "account_disabled" });

    assert.equal((await app.inject({ method: "POST", url: "/admin/accounts/1001/enable", headers: admin })).statusCode, 204);
    const again = await signIn();
    assert.equal((await createChannel(again.key)).statusCode, 201);
    assert.equal((await app.inject({ method: "POST", url: "/admin/accounts/999/disable", headers: admin })).statusCode, 404);
    await app.close();
  });
});

test("services created with a key can only be bound by the same account", async () => {
  const { app, signIn, createChannel } = setup();
  const octo = await signIn();
  const other = await signIn({ id: "2002", login: "hubot" });
  const service = await app.inject({ method: "POST", url: "/services", headers: { "x-ap-key": octo.key }, payload: { name: `svc-${randomUUID().slice(0, 8)}` } });
  assert.equal(service.statusCode, 201);
  const mine = (await createChannel(octo.key)).json();
  const theirs = (await createChannel(other.key)).json();
  const bind = (channel: { channel: string; secret: string }, key: string) => app.inject({
    method: "PUT",
    url: `/services/${service.json().name}/instances/${channel.channel}`,
    headers: { "x-ap-service-secret": service.json().secret, "x-ap-downstream-secret": channel.secret, "x-ap-key": key },
  });
  const denied = await bind(theirs, other.key);
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(denied.json(), { error: "service_not_owned" });
  assert.equal((await bind(theirs, octo.key)).statusCode, 403);
  assert.equal((await bind(mine, octo.key)).statusCode, 204);
  await app.close();
});
