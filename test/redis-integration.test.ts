import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { Redis } from "@upstash/redis";

import { RedisBroker } from "../src/redis-broker.js";
import { buildTestApp } from "./build-test-app.js";

const integrationOptions = { skip: process.env.AP_REDIS_INTEGRATION !== "1" };

function request() {
  return { method: "GET", path: "/ping", headers: {}, body: null };
}

async function cleanup(redis: Redis, channel: string) {
  await redis.del(`ap:channel:${channel}`, `ap:channel:${channel}:requests`);
}

test("Redis broker completes a real request round trip", integrationOptions, async () => {
  const redis = Redis.fromEnv();
  const broker = new RedisBroker(redis);
  const { id: channel, secret } = await broker.createChannel(`redis-test-${randomUUID()}`);
  const queueKey = `ap:channel:${channel}:requests`;

  try {
    await broker.health();
    const responsePromise = broker.dispatch(channel, request());
    const pending = await broker.next(channel, secret, 2_000);

    assert.ok(pending);
    await broker.respond(channel, secret, pending.id, {
      statusCode: 200,
      body: { pong: true },
    });
    assert.deepEqual(await responsePromise, { statusCode: 200, body: { pong: true } });
  } finally {
    await redis.del(`ap:channel:${channel}`, queueKey);
  }
});

test("Redis broker removes an unconsumed request after timeout", integrationOptions, async () => {
  const redis = Redis.fromEnv();
  const broker = new RedisBroker(redis);
  const { id: channel, secret } = await broker.createChannel(`redis-test-${randomUUID()}`);

  try {
    await assert.rejects(broker.dispatch(channel, request(), 100), /DOWNSTREAM_TIMEOUT/);
    assert.equal(await broker.next(channel, secret, 0), null);
  } finally {
    await cleanup(redis, channel);
  }
});

test("Redis broker rejects a response after timeout", integrationOptions, async () => {
  const redis = Redis.fromEnv();
  const broker = new RedisBroker(redis);
  const { id: channel, secret } = await broker.createChannel(`redis-test-${randomUUID()}`);

  try {
    const responsePromise = broker.dispatch(channel, request(), 100);
    const pending = await broker.next(channel, secret, 2_000);
    assert.ok(pending);
    await assert.rejects(responsePromise, /DOWNSTREAM_TIMEOUT/);
    await assert.rejects(
      broker.respond(channel, secret, pending.id, { statusCode: 200 }),
      /REQUEST_NOT_FOUND/,
    );
  } finally {
    await cleanup(redis, channel);
  }
});

test("Redis broker preserves a channel across broker instances", integrationOptions, async () => {
  const redis = Redis.fromEnv();
  const broker = new RedisBroker(redis);
  const restartedBroker = new RedisBroker(redis);
  const { id: channel, secret } = await broker.createChannel(`redis-test-${randomUUID()}`);

  try {
    const responsePromise = broker.dispatch(channel, request());
    const pending = await restartedBroker.next(channel, secret, 2_000);
    assert.ok(pending);
    await restartedBroker.respond(channel, secret, pending.id, {
      statusCode: 200,
      body: { pong: true },
    });
    assert.deepEqual(await responsePromise, { statusCode: 200, body: { pong: true } });
  } finally {
    await cleanup(redis, channel);
  }
});

test("Redis-backed HTTP auth accepts the secret returned by channel creation", integrationOptions, async () => {
  const redis = Redis.fromEnv();
  // A unique prefix keeps the shared 127.0.0.1 rate limit from carrying over between runs.
  const prefix = `ap-test:${randomUUID()}:`;
  const creator = new RedisBroker(redis, undefined, prefix);
  const poller = new RedisBroker(redis, undefined, prefix);
  const app = buildTestApp(poller);
  const created = await app.inject({ method: "POST", url: "/channels" });
  const { channel, secret } = created.json() as { channel: string; secret: string };

  try {
    assert.equal(created.statusCode, 201);
    const responsePromise = creator.dispatch(channel, request());
    const next = await app.inject({
      method: "GET",
      url: `/channels/${channel}/next`,
      headers: { authorization: `Bearer ${secret}` },
    });
    assert.equal(next.statusCode, 200);
    await poller.respond(channel, secret, next.json().id, { statusCode: 200, body: "ok" });
    assert.deepEqual(await responsePromise, { statusCode: 200, body: "ok" });
  } finally {
    await redis.del(`${prefix}channel:${channel}`, `${prefix}channel:${channel}:requests`);
    await app.close();
  }
});
