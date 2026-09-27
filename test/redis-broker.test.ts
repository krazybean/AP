import assert from "node:assert/strict";
import { test } from "node:test";

import { BrokerUnavailableError } from "../src/broker.js";
import { RedisBroker } from "../src/redis-broker.js";

class FakeRedis {
  private readonly values = new Map<string, unknown>();
  private readonly lists = new Map<string, unknown[]>();
  readonly counts = new Map<string, number>();
  failWith: Error | null = null;

  private count(name: string) {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    if (this.failWith) throw this.failWith;
  }

  totalCommands() {
    return [...this.counts.values()].reduce((sum, value) => sum + value, 0);
  }

  async set(key: string, value: unknown) {
    this.count("set");
    this.values.set(key, value);
  }

  async ping() {
    this.count("ping");
    return "PONG";
  }

  async get<T>(key: string) {
    this.count("get");
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async exists(key: string) {
    this.count("exists");
    return this.values.has(key) ? 1 : 0;
  }

  async incr(key: string) {
    this.count("incr");
    const count = Number(this.values.get(key) ?? 0) + 1;
    this.values.set(key, count);
    return count;
  }

  async rpush(key: string, value: unknown) {
    this.count("rpush");
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
  }

  async lpop<T>(key: string) {
    this.count("lpop");
    return (this.lists.get(key)?.shift() as T | undefined) ?? null;
  }

  async lrem(key: string, _count: number, value: unknown) {
    this.count("lrem");
    const list = this.lists.get(key) ?? [];
    this.lists.set(key, list.filter((item) => item !== value));
  }

  async expire() {
    this.count("expire");
  }

  async del(key: string) {
    this.count("del");
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

test("Redis channel creation has a bounded command budget", async () => {
  const redis = new FakeRedis();
  const broker = new RedisBroker(redis as never);

  await broker.createChannel("budget-test");

  assert.equal(redis.totalCommands(), 3, "INCR + EXPIRE + SET on the first bucket hit");
  assert.equal(broker.metrics().redisCommands, 3);
});

test("idle downstream polling is adaptive instead of a 100ms command storm", async () => {
  const redis = new FakeRedis();
  const broker = new RedisBroker(redis as never);
  const { id, secret } = await broker.createChannel("idle-budget");
  const before = redis.totalCommands();

  assert.equal(await broker.next(id, secret, 400), null);

  const commands = redis.totalCommands() - before;
  assert.equal(commands, 5, "GET auth + EXPIRE + three adaptive LPOP attempts");
  assert.equal(redis.counts.get("lpop"), 3);
  assert.equal(broker.metrics().redisPollCommands, 3);
});

test("Redis provider quota failures become service-level broker failures", async () => {
  const redis = new FakeRedis();
  const broker = new RedisBroker(redis as never);
  redis.failWith = new Error("ERR max requests limit exceeded. Limit: 500000, Usage: 500000.");

  await assert.rejects(
    broker.health(),
    (error: unknown) => error instanceof BrokerUnavailableError,
  );
});
