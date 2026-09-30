import assert from "node:assert/strict";
import { test } from "node:test";

import { scopeAllows, validateScopes } from "../src/client-scopes.js";
import { ChannelBroker } from "../src/channel-broker.js";
import { buildTestApp } from "./build-test-app.js";

async function protectedChannel(app: ReturnType<typeof buildTestApp>, scopes?: unknown) {
  const response = await app.inject({ method: "POST", url: "/channels", payload: { access: { mode: "bearer", ...(scopes === undefined ? {} : { scopes }) } } });
  assert.equal(response.statusCode, 201);
  return response.json() as { channel: string; secret: string; access: { token: string } };
}

async function roundTrip(app: ReturnType<typeof buildTestApp>, channel: string, secret: string, token: string, method: string, url: string) {
  const request = app.inject({ method, url, headers: { "x-ap-access-token": token, authorization: "Bearer app" }, payload: method === "POST" ? { value: 1 } : undefined });
  const pending = await app.inject({ method: "GET", url: `/channels/${channel}/next`, headers: { authorization: `Bearer ${secret}` } });
  assert.equal(pending.statusCode, 200);
  const response = await app.inject({ method: "POST", url: `/channels/${channel}/responses/${pending.json().id}`, headers: { authorization: `Bearer ${secret}` }, payload: { statusCode: 200, body: "ok" } });
  assert.equal(response.statusCode, 202);
  return request;
}

test("scope grammar and method matching are deterministic", () => {
  const read = [{ methods: ["get"], path: "/projects/*" }];
  assert.deepEqual(validateScopes(read), [{ methods: ["GET"], path: "/projects/*" }]);
  assert.equal(scopeAllows(validateScopes(read)!, "GET", "/projects/1"), true);
  assert.equal(scopeAllows(validateScopes(read)!, "POST", "/projects/1"), false);
  assert.equal(scopeAllows(validateScopes([{ methods: ["GET"], path: "/projects" }])!, "GET", "/projects"), true);
  assert.equal(scopeAllows(validateScopes([{ methods: ["GET"], path: "/projects" }])!, "GET", "/projects/1"), false);
  assert.equal(scopeAllows(validateScopes([{ methods: ["GET"], path: "/*" }])!, "GET", "/anything"), true);
  assert.equal(scopeAllows(validateScopes([{ methods: ["GET"], path: "/*" }])!, "POST", "/anything"), false);
});

test("unrestricted credentials preserve Wave 2A behavior", async () => {
  const broker = new ChannelBroker();
  const app = buildTestApp(broker);
  const created = await protectedChannel(app);
  assert.equal((await roundTrip(app, created.channel, created.secret, created.access.token, "POST", `/c/${created.channel}/generate`)).statusCode, 200);
  await app.close();
});

test("exact and subtree scopes enforce method and application path", async () => {
  const broker = new ChannelBroker();
  const app = buildTestApp(broker);
  const exact = await protectedChannel(app, [{ methods: ["GET"], path: "/projects" }]);
  assert.equal((await roundTrip(app, exact.channel, exact.secret, exact.access.token, "GET", `/c/${exact.channel}/projects`)).statusCode, 200);
  for (const request of [
    { method: "POST", url: `/c/${exact.channel}/projects` },
    { method: "GET", url: `/c/${exact.channel}/projects/1` },
    { method: "GET", url: `/c/${exact.channel}/other` },
  ]) assert.equal((await app.inject({ ...request, headers: { "x-ap-access-token": exact.access.token } })).statusCode, 403);

  const subtree = await protectedChannel(app, [{ methods: ["GET"], path: "/projects/*" }]);
  assert.equal((await roundTrip(app, subtree.channel, subtree.secret, subtree.access.token, "GET", `/c/${subtree.channel}/projects/1`)).statusCode, 200);
  const queryRequest = app.inject({ method: "GET", url: `/c/${subtree.channel}/projects/1?view=full`, headers: { "x-ap-access-token": subtree.access.token } });
  const queryPending = await app.inject({ method: "GET", url: `/channels/${subtree.channel}/next`, headers: { authorization: `Bearer ${subtree.secret}` } });
  assert.equal(queryPending.json().path, "/projects/1?view=full");
  await app.inject({ method: "POST", url: `/channels/${subtree.channel}/responses/${queryPending.json().id}`, headers: { authorization: `Bearer ${subtree.secret}` }, payload: { statusCode: 200 } });
  assert.equal((await queryRequest).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: `/c/${subtree.channel}/projects`, headers: { "x-ap-access-token": subtree.access.token } })).statusCode, 403);
  await app.close();
});

test("multiple credentials are isolated and denied requests consume no capacity", async () => {
  const broker = new ChannelBroker();
  const app = buildTestApp(broker);
  const created = await protectedChannel(app, [{ methods: ["GET"], path: "/read/*" }]);
  const second = await app.inject({ method: "POST", url: `/channels/${created.channel}/access-tokens`, headers: { "x-ap-downstream-secret": created.secret }, payload: { scopes: [{ methods: ["POST"], path: "/write/*" }] } });
  assert.equal(second.statusCode, 201);
  const denied = await app.inject({ method: "GET", url: `/c/${created.channel}/write/item`, headers: { "x-ap-access-token": second.json().token } });
  assert.equal(denied.statusCode, 403);
  assert.equal(broker.metrics().queuedRequests + broker.metrics().inFlightRequests, 0);
  assert.equal((await roundTrip(app, created.channel, created.secret, second.json().token, "POST", `/c/${created.channel}/write/item`)).statusCode, 200);
  await app.close();
});

test("empty and malformed scopes are rejected before channel creation", async () => {
  const app = buildTestApp(new ChannelBroker());
  for (const scopes of [
    [],
    [{ methods: ["GET"], path: "projects" }],
    [{ methods: ["GET"], path: "/projects/*/items" }],
    [{ methods: ["GET"], path: "/projects/**" }],
    [{ methods: [""], path: "/projects" }],
    [{ methods: ["GET"], path: "/projects?x=1" }],
  ]) assert.equal((await app.inject({ method: "POST", url: "/channels", payload: { access: { mode: "bearer", scopes } } })).statusCode, 400);
  await app.close();
});

test("ambiguous encoded and dot-segment paths fail closed", async () => {
  const app = buildTestApp(new ChannelBroker());
  const created = await protectedChannel(app, [{ methods: ["GET"], path: "/projects/*" }]);
  for (const path of ["/projects/", "/projects//1", "/projects/../admin", "/projects/%2e%2e/admin", "/projects/%2fadmin", "/projects/%5cadmin", "/projects/%", "/projects/％"] ) {
    const response = await app.inject({ method: "GET", url: `/c/${created.channel}${path}`, headers: { "x-ap-access-token": created.access.token } });
    assert.ok([400, 403].includes(response.statusCode), `${path}: ${response.statusCode}`);
  }
  await app.close();
});
