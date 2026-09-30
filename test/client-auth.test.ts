import assert from "node:assert/strict";
import { test } from "node:test";

import { ChannelBroker } from "../src/channel-broker.js";
import { buildTestApp } from "./build-test-app.js";

const validId = "c0a80101-0000-4000-8000-000000000001";

test("public channels preserve the existing proxy contract", async () => {
  const broker = new ChannelBroker();
  const created = await broker.createChannel();
  const app = buildTestApp(broker);
  const request = app.inject({ method: "GET", url: `/c/${created.id}/projects`, headers: { authorization: "Bearer app" } });
  const pending = await broker.next(created.id, created.secret, 0);
  assert.ok(pending);
  await broker.respond(created.id, created.secret, pending.id, { statusCode: 200, body: "ok" });
  assert.equal((await request).statusCode, 200);
  await app.close();
});

test("protected creation returns a one-time client token and rejects unauthenticated traffic", async () => {
  const app = buildTestApp(new ChannelBroker());
  const created = await app.inject({ method: "POST", url: "/channels", payload: { access: { mode: "bearer" } } });
  assert.equal(created.statusCode, 201);
  const body = created.json();
  assert.equal(body.access.mode, "bearer");
  assert.match(body.access.token, /^apc_[A-Za-z0-9_-]{43}$/);
  assert.equal((await app.inject({ method: "GET", url: `/c/${body.channel}` })).statusCode, 401);
  const publicRequest = app.inject({ method: "GET", url: `/c/${body.channel}`, headers: { "x-ap-access-token": body.access.token, authorization: "Bearer application-token" } });
  const next = await app.inject({ method: "GET", url: `/channels/${body.channel}/next`, headers: { authorization: `Bearer ${body.secret}` } });
  assert.equal(next.json().headers.authorization, "Bearer application-token");
  assert.equal(next.json().headers["x-ap-access-token"], undefined);
  await app.inject({ method: "POST", url: `/channels/${body.channel}/responses/${next.json().id}`, headers: { authorization: `Bearer ${body.secret}` }, payload: { statusCode: 200, body: "ok" } });
  assert.equal((await publicRequest).statusCode, 200);
  await app.close();
});

test("AP access token is separate from downstream Authorization and is not forwarded", async () => {
  let headers: Record<string, string | string[] | undefined> | undefined;
  const broker = new ChannelBroker();
  const originalDispatch = broker.dispatch.bind(broker);
  const created = await broker.createChannel();
  const app = buildTestApp({
    ...broker,
    dispatch: async (id: string, request: { headers: Record<string, string | string[] | undefined> }) => {
      headers = request.headers;
      return originalDispatch(id, { method: "GET", path: "/", headers: request.headers, body: undefined }, 1);
    },
    authenticateClient: broker.authenticateClient.bind(broker),
    createClientCredential: broker.createClientCredential.bind(broker),
    revokeClientCredential: broker.revokeClientCredential.bind(broker),
  } as never);
  assert.equal((await app.inject({
    method: "GET", url: `/c/${created.id}`, headers: {
      "x-ap-access-token": "apc_test", authorization: "Bearer app",
    },
  })).statusCode, 504);
  assert.equal(headers?.authorization, "Bearer app");
  assert.equal(headers?.["x-ap-access-token"], undefined);
  await app.close();
});

test("credential lifecycle supports rotation, revocation, expiry, and a bounded limit", async () => {
  const broker = new ChannelBroker();
  const created = await broker.createChannel("test", 10, { mode: "bearer" });
  const second = await broker.createClientCredential(created.id, created.secret);
  assert.equal(await broker.authenticateClient(created.id, created.clientCredential!.token), undefined);
  assert.equal(await broker.authenticateClient(created.id, second.token), undefined);
  await assert.rejects(() => broker.authenticateClient(created.id, created.secret), /CLIENT_CREDENTIAL_INVALID/);
  await assert.rejects(() => broker.authenticateClient(created.id, "apc_短"), /CLIENT_CREDENTIAL_INVALID/);
  await assert.rejects(() => broker.next(created.id, created.clientCredential!.token, 0), /CHANNEL_UNAUTHORIZED/);
  await broker.revokeClientCredential(created.id, created.secret, second.id);
  await assert.rejects(() => broker.authenticateClient(created.id, second.token), /CLIENT_CREDENTIAL_INVALID/);
  await assert.rejects(() => broker.revokeClientCredential(created.id, created.secret, second.id), /CLIENT_CREDENTIAL_NOT_FOUND/);
  const expired = await broker.createClientCredential(created.id, created.secret, Date.now() + 5);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(() => broker.authenticateClient(created.id, expired.token), /CLIENT_CREDENTIAL_EXPIRED/);
  for (let i = 0; i < 9; i++) await broker.createClientCredential(created.id, created.secret);
  await assert.rejects(() => broker.createClientCredential(created.id, created.secret), /CLIENT_CREDENTIAL_LIMIT/);
  assert.notEqual(created.clientCredential!.token, created.secret);
  assert.equal(await broker.authenticateClient(validId, created.clientCredential!.token).catch(() => false), false);
});

test("credential control endpoints require the dedicated downstream secret header", async () => {
  const app = buildTestApp(new ChannelBroker());
  const created = (await app.inject({ method: "POST", url: "/channels", payload: { access: { mode: "bearer" } } })).json();
  assert.equal((await app.inject({ method: "POST", url: `/channels/${created.channel}/access-tokens`, headers: { authorization: `Bearer ${created.secret}` }, payload: {} })).statusCode, 401);
  const added = await app.inject({ method: "POST", url: `/channels/${created.channel}/access-tokens`, headers: { "x-ap-downstream-secret": created.secret }, payload: {} });
  assert.equal(added.statusCode, 201);
  const credential = added.json();
  assert.equal((await app.inject({ method: "DELETE", url: `/channels/${created.channel}/access-tokens/${credential.credentialId}`, headers: { "x-ap-downstream-secret": created.secret } })).statusCode, 204);
  await app.close();
});
