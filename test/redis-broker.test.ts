import assert from "node:assert/strict";
import { test } from "node:test";

import { RedisBroker } from "../src/redis-broker.js";

class FakeRedis {
  private readonly values = new Map<string, unknown>();
  private readonly lists = new Map<string, unknown[]>();

  async set(key: string, value: unknown) {
    this.values.set(key, value);
  }

  async ping() {
    return "PONG";
  }

  async get<T>(key: string) {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async exists(key: string) {
    return this.values.has(key) ? 1 : 0;
  }

  async incr(key: string) {
    const count = Number(this.values.get(key) ?? 0) + 1;
    this.values.set(key, count);
    return count;
  }

  async rpush(key: string, value: unknown) {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
  }

  async lpop<T>(key: string) {
    return (this.lists.get(key)?.shift() as T | undefined) ?? null;
  }

  async lrem(key: string, _count: number, value: unknown) {
    const list = this.lists.get(key) ?? [];
    this.lists.set(key, list.filter((item) => item !== value));
  }

  async expire() {}

  async del(key: string) {
    this.values.delete(key);
  }
}

test("Redis broker binds responses to pending requests", async () => {
  const broker = new RedisBroker(new FakeRedis() as never);
  const { id: channel, secret } = await broker.createChannel();
  const request = { method: "GET", path: "/ping", headers: {}, body: null };
  const responsePromise = broker.dispatch(channel, request, 1_000);
  const pending = await broker.next(channel, secret, 1_000);

  assert.ok(pending);
  await assert.rejects(
    broker.respond(channel, secret, "not-a-request", { statusCode: 200 }),
    /REQUEST_NOT_FOUND/,
  );

  await broker.respond(channel, secret, pending.id, { statusCode: 200, body: { pong: true } });
  assert.deepEqual(await responsePromise, { statusCode: 200, body: { pong: true } });
});

test("Redis broker removes an unconsumed request after timeout", async () => {
  const broker = new RedisBroker(new FakeRedis() as never);
  const { id: channel, secret } = await broker.createChannel();

  await assert.rejects(
    broker.dispatch(channel, { method: "GET", path: "/ping", headers: {}, body: null }, 1),
    /DOWNSTREAM_TIMEOUT/,
  );
  assert.equal(await broker.next(channel, secret, 0), null);
});

test("Redis broker rejects a response after timeout", async () => {
  const broker = new RedisBroker(new FakeRedis() as never);
  const { id: channel, secret } = await broker.createChannel();
  const responsePromise = broker.dispatch(
    channel,
    { method: "GET", path: "/ping", headers: {}, body: null },
    1_000,
  );
  const pending = await broker.next(channel, secret, 1_000);

  assert.ok(pending);
  await assert.rejects(responsePromise, /DOWNSTREAM_TIMEOUT/);
  await assert.rejects(
    broker.respond(channel, secret, pending.id, { statusCode: 200 }),
    /REQUEST_NOT_FOUND/,
  );
});
