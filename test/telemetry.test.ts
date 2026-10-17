import assert from "node:assert/strict";
import Fastify from "fastify";
import { test } from "node:test";

import { testBroker } from "./test-broker.js";
import { BrokerCapacityError, BrokerUnavailableError } from "../src/broker.js";
import { isSecurityAuditEvent, type AuditSink, type SecurityAuditEvent } from "../src/security-telemetry.js";
import { registerRoutes } from "../src/routes.js";

const baseDomain = "channels.example.test";

function appWithSink(events: SecurityAuditEvent[], broker = testBroker(), sink: AuditSink = { emit: (event) => events.push(event) }) {
  const app = Fastify({ logger: false });
  registerRoutes(app, broker, { auditSink: sink });
  return app;
}

test("audit events use a fixed schema and never contain request secrets", async () => {
  const events: SecurityAuditEvent[] = [];
  const app = appWithSink(events);
  const secret = "downstream-secret-marker";
  const token = "apc-client-token-marker";
  const created = await app.inject({
    method: "POST", url: "/channels",
    payload: { access: { mode: "bearer", scopes: [{ methods: ["GET"], path: "/allowed" }] } },
  });
  const body = created.json();
  await app.inject({ method: "GET", url: `/c/${body.channel}/denied?q=query-secret-marker`, headers: { "x-ap-access-token": body.access.token, authorization: `Bearer ${secret}`, cookie: `session=${token}` } });
  await app.inject({ method: "GET", url: `/c/${body.channel}/denied`, headers: { "x-ap-access-token": token } });
  await app.inject({ method: "POST", url: `/channels/${body.channel}/access-tokens`, headers: { "x-ap-downstream-secret": secret }, payload: {} });
  const extra = await app.inject({ method: "POST", url: `/channels/${body.channel}/access-tokens`, headers: { "x-ap-downstream-secret": body.secret }, payload: {} });
  await app.inject({ method: "DELETE", url: `/channels/${body.channel}/access-tokens/${extra.json().credentialId}`, headers: { "x-ap-downstream-secret": body.secret } });

  assert.ok(events.length >= 2);
  for (const event of events) {
    assert.equal(isSecurityAuditEvent(event), true);
    const serialized = JSON.stringify(event);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes(token), false);
    assert.equal(serialized.includes("authorization"), false);
    assert.equal(serialized.includes("cookie"), false);
    assert.equal(serialized.includes("query-secret-marker"), false);
  }
  assert.ok(events.some((event) => event.event === "channel.created"));
  assert.ok(events.some((event) => event.event === "auth.client.rejected"));
  assert.ok(events.some((event) => event.event === "auth.downstream.rejected"));
  assert.ok(events.some((event) => event.event === "auth.scope_denied"));
  assert.ok(events.some((event) => event.event === "credential.revoked"));
  await app.close();
});

test("every response has a generated correlation ID and audits reuse it", async () => {
  const events: SecurityAuditEvent[] = [];
  const app = appWithSink(events);
  const response = await app.inject({ method: "POST", url: "/channels", headers: { "x-ap-request-id": `${"x".repeat(1000)}\nforged` } });
  const requestId = response.headers["x-ap-request-id"];
  assert.equal(typeof requestId, "string");
  assert.ok(requestId.length < 128);
  assert.equal(/[\u0000-\u001f\u007f]/.test(requestId), false);
  assert.equal(events.at(-1)?.requestId, requestId);
  await app.close();
});

test("telemetry failure cannot change authentication or authorization decisions", async () => {
  const events: SecurityAuditEvent[] = [];
  const sink: AuditSink = { emit: () => { throw new Error("AUDIT_SINK_DOWN"); } };
  const app = appWithSink(events, testBroker(), sink);
  const created = await app.inject({ method: "POST", url: "/channels", payload: { access: { mode: "bearer", scopes: [{ methods: ["GET"], path: "/allowed" }] } } });
  const body = created.json();
  assert.equal((await app.inject({ method: "GET", url: `/c/${body.channel}/denied`, headers: { "x-ap-access-token": body.access.token } })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: `/c/${body.channel}/allowed` })).statusCode, 401);
  const metrics = await app.inject({ method: "GET", url: "/metrics" });
  assert.equal(metrics.statusCode, 200);
  assert.ok(metrics.json().security.auditEmissionFailures >= 1);
  await app.close();
});

test("security metrics expose only bounded reason and mode dimensions", async () => {
  const events: SecurityAuditEvent[] = [];
  const prior = process.env.AP_CHANNEL_BASE_DOMAIN;
  process.env.AP_CHANNEL_BASE_DOMAIN = baseDomain;
  const app = appWithSink(events);
  const channel = await app.inject({ method: "POST", url: "/channels", payload: { exposure: { mode: "isolated-host" } } });
  const channelId = channel.json().channel;
  await app.inject({ method: "GET", url: `/c/${channelId}/x` });
  await Promise.all(Array.from({ length: 100 }, (_, index) => app.inject({
    method: "GET",
    url: `/probe/${index}?path-secret-${index}`,
    headers: { host: `${channelId}.${baseDomain}.evil-${index}.example` },
  })));
  const metrics = await app.inject({ method: "GET", url: "/metrics" });
  const serialized = JSON.stringify(metrics.json());
  assert.equal(serialized.includes(channelId), false);
  assert.equal(serialized.includes("/c/"), false);
  assert.equal(serialized.includes(baseDomain), false);
  assert.equal(serialized.includes("evil-99"), false);
  assert.match(serialized, /authFailures|invalidHosts|channelsCreated/);
  await app.close();
  if (prior === undefined) delete process.env.AP_CHANNEL_BASE_DOMAIN;
  else process.env.AP_CHANNEL_BASE_DOMAIN = prior;
});

test("origin telemetry uses bounded reasons without host or path labels", async () => {
  const events: SecurityAuditEvent[] = [];
  const prior = process.env.AP_CHANNEL_BASE_DOMAIN;
  process.env.AP_CHANNEL_BASE_DOMAIN = baseDomain;
  const app = appWithSink(events);
  const created = await app.inject({ method: "POST", url: "/channels", payload: { exposure: { mode: "isolated-host" } } });
  const channel = created.json().channel;
  await app.inject({ method: "GET", url: "/probe?secret=query-secret-marker", headers: { host: `${channel}.${baseDomain}.evil.example` } });
  await app.inject({ method: "GET", url: `/c/${channel}/legacy-secret-marker` });
  assert.ok(events.some((event) => event.event === "origin.invalid_host" && event.reason === "invalid_suffix"));
  assert.ok(events.some((event) => event.event === "origin.legacy_path_blocked"));
  const metrics = await app.inject({ method: "GET", url: "/metrics" });
  assert.equal(JSON.stringify(metrics.json()).includes("legacy-secret-marker"), false);
  await app.close();
  if (prior === undefined) delete process.env.AP_CHANNEL_BASE_DOMAIN;
  else process.env.AP_CHANNEL_BASE_DOMAIN = prior;
});

test("capacity and timeout telemetry are emitted once at the HTTP boundary", async () => {
  const capacityEvents: SecurityAuditEvent[] = [];
  const capacityBroker = testBroker();
  const capacityChannel = await capacityBroker.createChannel();
  capacityBroker.dispatch = async () => { throw new BrokerCapacityError(); };
  const capacityApp = appWithSink(capacityEvents, capacityBroker);
  assert.equal((await capacityApp.inject({ method: "GET", url: `/c/${capacityChannel.id}` })).statusCode, 429);
  assert.equal(capacityEvents.filter((event) => event.event === "channel.capacity_rejected").length, 1);
  await capacityApp.close();

  const timeoutEvents: SecurityAuditEvent[] = [];
  const timeoutBroker = testBroker();
  const timeoutChannel = await timeoutBroker.createChannel();
  timeoutBroker.dispatch = async () => { throw new Error("DOWNSTREAM_TIMEOUT"); };
  const timeoutApp = appWithSink(timeoutEvents, timeoutBroker);
  assert.equal((await timeoutApp.inject({ method: "GET", url: `/c/${timeoutChannel.id}` })).statusCode, 504);
  assert.equal(timeoutEvents.filter((event) => event.event === "request.timeout").length, 1);
  await timeoutApp.close();
});

test("broker failures are audited without exposing provider details", async () => {
  const events: SecurityAuditEvent[] = [];
  const broker = testBroker();
  const channel = await broker.createChannel();
  broker.dispatch = async () => { throw new BrokerUnavailableError("REDIS_URL_SECRET_MARKER"); };
  const app = appWithSink(events, broker);
  assert.equal((await app.inject({ method: "GET", url: `/c/${channel.id}` })).statusCode, 503);
  assert.ok(events.some((event) => event.event === "broker.unavailable"));
  assert.equal(JSON.stringify(events).includes("REDIS_URL_SECRET_MARKER"), false);
  await app.close();
});
