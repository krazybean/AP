import assert from "node:assert/strict";
import test from "node:test";

import { testBroker } from "./test-broker.js";
import { SERVICE_INSTANCE_LIMIT, validateServiceName } from "../src/services.js";
import { buildTestApp } from "./build-test-app.js";

test("service names use the strict DNS-safe grammar and reserve control names", () => {
  for (const name of ["api", "ap", "health", "metrics", "channels", "services", "A", "-bad", "bad-", "bad_name", "bad.name", "", "a".repeat(64)]) {
    assert.throws(() => validateServiceName(name), /INVALID_SERVICE_NAME/);
  }
  for (const name of ["billing", "billing-v2", "a", "a".repeat(63)]) {
    assert.equal(validateServiceName(name), name);
  }
});

test("broker creates an opaque service and returns its secret only at creation", async () => {
  const broker = testBroker();
  const created = await broker.createService("billing");
  assert.match(created.serviceId, /^[0-9a-f-]{36}$/);
  assert.match(created.secret, /^aps_[A-Za-z0-9_-]{43}$/);
  assert.equal(created.name, "billing");
  assert.ok(created.createdAt);
  const discovered = await broker.getService("billing");
  assert.deepEqual(discovered?.service, {
    serviceId: created.serviceId,
    name: created.name,
    createdAt: created.createdAt,
  });
  assert.equal("secret" in (discovered ?? {}), false);
  await assert.rejects(() => broker.createService("billing"), /SERVICE_NAME_TAKEN/);
});

test("service binding is idempotent, exclusive, bounded, and does not delete channels", async () => {
  const broker = testBroker();
  const service = await broker.createService("billing");
  const other = await broker.createService("shipping");
  const channel = await broker.createChannel();

  await broker.bindServiceInstance("billing", service.secret, channel.id, channel.secret);
  await broker.bindServiceInstance("billing", service.secret, channel.id, channel.secret);
  await assert.rejects(
    () => broker.bindServiceInstance("shipping", other.secret, channel.id, channel.secret),
    /SERVICE_CHANNEL_CONFLICT/,
  );
  await broker.unbindServiceInstance("billing", service.secret, channel.id, channel.secret);
  await broker.unbindServiceInstance("billing", service.secret, channel.id, channel.secret);
  assert.equal(await broker.hasChannel(channel.id), true);

  for (let index = 0; index < SERVICE_INSTANCE_LIMIT; index += 1) {
    const item = await broker.createChannel("service-test", 100);
    await broker.bindServiceInstance("billing", service.secret, item.id, item.secret);
  }
  const overflow = await broker.createChannel("service-test", 100);
  await assert.rejects(
    () => broker.bindServiceInstance("billing", service.secret, overflow.id, overflow.secret),
    /SERVICE_INSTANCE_LIMIT/,
  );
});

test("service HTTP API creates, discovers, binds, and unbinds without exposing secrets", async () => {
  const broker = testBroker();
  const app = buildTestApp(broker);
  const created = await app.inject({ method: "POST", url: "/services", payload: { name: "billing" } });
  assert.equal(created.statusCode, 201);
  const service = created.json();
  assert.match(service.secret, /^aps_/);

  const duplicate = await app.inject({ method: "POST", url: "/services", payload: { name: "billing" } });
  assert.equal(duplicate.statusCode, 409);
  assert.equal((await app.inject({ method: "POST", url: "/services", payload: { name: "api" } })).statusCode, 400);

  const channel = await app.inject({ method: "POST", url: "/channels" });
  const channelData = channel.json();
  const wrongService = await app.inject({
    method: "PUT",
    url: `/services/billing/instances/${channelData.channel}`,
    headers: { "x-ap-service-secret": "aps_wrong", "x-ap-downstream-secret": channelData.secret },
  });
  assert.equal(wrongService.statusCode, 401);
  const wrongChannel = await app.inject({
    method: "PUT",
    url: `/services/billing/instances/${channelData.channel}`,
    headers: { "x-ap-service-secret": service.secret, "x-ap-downstream-secret": "wrong" },
  });
  assert.equal(wrongChannel.statusCode, 401);
  const bound = await app.inject({
    method: "PUT",
    url: `/services/billing/instances/${channelData.channel}`,
    headers: { "x-ap-service-secret": service.secret, "x-ap-downstream-secret": channelData.secret },
  });
  assert.equal(bound.statusCode, 204);

  const discovery = await app.inject({ method: "GET", url: "/services/billing" });
  assert.equal(discovery.statusCode, 200);
  const body = discovery.json();
  assert.equal(body.serviceId, service.serviceId);
  assert.equal(body.instances.length, 1);
  assert.equal(body.instances[0].channel, channelData.channel);
  assert.equal("secret" in body, false);
  assert.equal(JSON.stringify(body).includes(channelData.secret), false);

  const unbound = await app.inject({
    method: "DELETE",
    url: `/services/billing/instances/${channelData.channel}`,
    headers: { "x-ap-service-secret": service.secret, "x-ap-downstream-secret": channelData.secret },
  });
  assert.equal(unbound.statusCode, 204);
  assert.equal((await app.inject({ method: "GET", url: "/services/billing" })).json().instances.length, 0);
  assert.equal(await broker.hasChannel(channelData.channel), true);
  await app.close();
});
