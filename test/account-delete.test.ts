import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { DeviceTokenResult, GitHubDeviceClient, GitHubUser } from "../src/github.js";
import type { GoogleDeviceClient } from "../src/google.js";
import { isSecurityAuditEvent, type SecurityAuditEvent } from "../src/security-telemetry.js";
import { buildTestApp } from "./build-test-app.js";
import { testBroker } from "./test-broker.js";

const CONFIRM = { confirm: "delete-my-account" };
const admin = { authorization: "Bearer admin-secret" };

function setup() {
  const broker = testBroker();
  const events: SecurityAuditEvent[] = [];
  let user: GitHubUser = { id: "1001", login: "octo" };
  const client: GitHubDeviceClient & GoogleDeviceClient = {
    startDevice: async () => ({ deviceCode: `dc-${randomUUID()}`, userCode: "ABCD-1234", verificationUri: "https://example.test/device", expiresIn: 900, interval: 0 }),
    pollToken: async () => ({ status: "approved", accessToken: "token" }) as DeviceTokenResult,
    user: async () => user,
  };
  const app = buildTestApp(broker, { github: client, google: client, auditSink: { emit: (event) => events.push(event) } });
  async function signIn(next: GitHubUser, provider: "github" | "google" = "github") {
    user = next;
    const started = await app.inject({ method: "POST", url: "/auth/device", payload: { provider } });
    const done = await app.inject({ method: "POST", url: "/auth/device/token", payload: { deviceId: started.json().deviceId, provider } });
    assert.equal(done.statusCode, 201, done.body);
    return done.json() as { key: string; keyId: string };
  }
  const del = (key: string | undefined, payload?: unknown) => app.inject({
    method: "DELETE", url: "/account", headers: key ? { "x-ap-key": key } : {}, ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { app, broker, events, signIn, del };
}

async function withAdmin<T>(run: () => Promise<T>) {
  const previous = process.env.AP_ADMIN_TOKEN;
  process.env.AP_ADMIN_TOKEN = "admin-secret";
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.AP_ADMIN_TOKEN;
    else process.env.AP_ADMIN_TOKEN = previous;
  }
}

test("deleting your account needs a key and an explicit confirmation", async () => {
  const { app, signIn, del } = setup();
  const octo = await signIn({ id: "1001", login: "octo" });
  assert.equal((await del(undefined, CONFIRM)).statusCode, 401);
  assert.equal((await del("apk_wrong", CONFIRM)).statusCode, 401);
  for (const payload of [undefined, {}, { confirm: true }, { confirm: "yes" }]) {
    const response = await del(octo.key, payload);
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
    assert.deepEqual(response.json(), { error: "confirmation_required" });
  }
  assert.equal((await app.inject({ method: "GET", url: "/keys", headers: { "x-ap-key": octo.key } })).statusCode, 200);
  await app.close();
});

test("deleting an account removes its keys, ownership and usage and leaves others alone", async () => {
  const { app, broker, events, signIn, del } = setup();
  const octo = await signIn({ id: "1001", login: "octo" });
  const second = await signIn({ id: "1001", login: "octo" });
  const hubot = await signIn({ id: "2002", login: "hubot" });
  const channel = (await app.inject({ method: "POST", url: "/channels", headers: { "x-ap-key": octo.key } })).json().channel as string;
  const service = `svc-${randomUUID().slice(0, 8)}`;
  assert.equal((await app.inject({ method: "POST", url: "/services", headers: { "x-ap-key": octo.key }, payload: { name: service } })).statusCode, 201);
  assert.equal(await broker.accounts.channelOwner(channel), "1001");
  assert.equal(await broker.accounts.serviceOwner(service), "1001");

  const response = await del(octo.key, CONFIRM);
  assert.equal(response.statusCode, 204);

  // Every key of that account is dead, and nothing about it is left in the store.
  for (const key of [octo.key, second.key]) {
    assert.equal((await app.inject({ method: "GET", url: "/keys", headers: { "x-ap-key": key } })).statusCode, 401);
  }
  assert.equal(await broker.accounts.channelOwner(channel), undefined);
  assert.equal(await broker.accounts.serviceOwner(service), undefined);
  assert.equal(await broker.accounts.usage("1001", async () => true), undefined);
  assert.deepEqual((await broker.accounts.listAccounts()).map((account) => account.githubId), ["2002"]);

  // The other account is untouched.
  assert.equal((await app.inject({ method: "GET", url: "/keys", headers: { "x-ap-key": hubot.key } })).statusCode, 200);
  // The first delete used up the account, so repeating it with the same key is just unauthorized.
  assert.equal((await del(octo.key, CONFIRM)).statusCode, 401);

  const deleted = events.filter((event) => event.event === "account.deleted");
  assert.equal(deleted.length, 1);
  assert.equal((deleted[0] as { githubId: string }).githubId, "1001");
  assert.ok(isSecurityAuditEvent(deleted[0]));
  assert.ok(!JSON.stringify(events).includes(octo.key));
  await app.close();
});

test("signing in again after deleting starts a fresh account", async () => {
  const { app, signIn, del } = setup();
  const before = await signIn({ id: "google:110248495921238986420", login: "ada@example.com" }, "google");
  assert.equal((await del(before.key, CONFIRM)).statusCode, 204);
  const after = await signIn({ id: "google:110248495921238986420", login: "ada@example.com" }, "google");
  assert.notEqual(after.key, before.key);
  assert.equal((await app.inject({ method: "GET", url: "/keys", headers: { "x-ap-key": after.key } })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/keys", headers: { "x-ap-key": before.key } })).statusCode, 401);
  await app.close();
});

test("the operator can delete an account by id, including google: ids", async () => {
  await withAdmin(async () => {
    const { app, broker, events, signIn } = setup();
    const octo = await signIn({ id: "1001", login: "octo" });
    const ada = await signIn({ id: "google:110248495921238986420", login: "ada@example.com" }, "google");
    const url = (id: string) => `/admin/accounts/${id}`;

    assert.equal((await app.inject({ method: "DELETE", url: url("1001") })).statusCode, 404);
    assert.equal((await app.inject({ method: "DELETE", url: url("1001"), headers: { authorization: "Bearer wrong" } })).statusCode, 404);
    assert.equal((await broker.accounts.listAccounts()).length, 2);

    assert.equal((await app.inject({ method: "DELETE", url: url("google:110248495921238986420"), headers: admin })).statusCode, 204);
    assert.equal((await app.inject({ method: "GET", url: "/keys", headers: { "x-ap-key": ada.key } })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/keys", headers: { "x-ap-key": octo.key } })).statusCode, 200);
    assert.equal((await app.inject({ method: "DELETE", url: url("google:110248495921238986420"), headers: admin })).statusCode, 404);
    assert.equal((await app.inject({ method: "DELETE", url: url("999"), headers: admin })).statusCode, 404);

    // Malformed ids never reach the store.
    for (const bad of ["google:", "google:abc", "google:1:2", "1:2", "google:1%0Aevent"]) {
      const response = await app.inject({ method: "DELETE", url: url(bad), headers: admin });
      assert.equal(response.statusCode, 404, bad);
      assert.deepEqual(response.json(), { error: "account_not_found" });
    }
    assert.equal((await broker.accounts.listAccounts()).length, 1);
    assert.deepEqual(events.filter((event) => event.event === "account.deleted").map((event) => (event as { githubId: string }).githubId), ["google:110248495921238986420"]);
    await app.close();
  });
});
