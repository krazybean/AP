import assert from "node:assert/strict";
import { test } from "node:test";

import { BrokerUnavailableError } from "../src/broker.js";
import { RedisBroker } from "../src/redis-broker.js";

class FakeRedis {
  private readonly values = new Map<string, unknown>();
  private readonly lists = new Map<string, unknown[]>();
  private readonly hashes = new Map<string, Map<string, unknown>>();
  private readonly sets = new Map<string, Set<string>>();
  readonly counts = new Map<string, number>();
  failWith: Error | null = null;
  beforeCancel?: () => Promise<void>;

  private count(name: string) {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    if (this.failWith) throw this.failWith;
  }

  totalCommands() {
    return [...this.counts.values()].reduce((sum, value) => sum + value, 0);
  }

  peek(key: string) { return this.lists.get(key)?.[0] as { id: string } | undefined; }

  async set(key: string, value: unknown, options?: { nx?: boolean }) {
    this.count("set");
    if (options?.nx && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async hset(key: string, values: Record<string, unknown>) {
    this.count("hset");
    const hash = this.hashes.get(key) ?? new Map();
    for (const [field, value] of Object.entries(values)) hash.set(field, value);
    this.hashes.set(key, hash);
  }

  async hget<T>(key: string, field: string) {
    this.count("hget");
    return (this.hashes.get(key)?.get(field) as T | undefined) ?? null;
  }

  async hgetall<T>(key: string) {
    this.count("hgetall");
    return Object.fromEntries(this.hashes.get(key) ?? []) as T;
  }

  async sadd(key: string, ...members: string[]) {
    this.count("sadd");
    const set = this.sets.get(key) ?? new Set<string>();
    const before = set.size;
    members.forEach((member) => set.add(member));
    this.sets.set(key, set);
    return set.size - before;
  }

  async smembers<T>(key: string) {
    this.count("smembers");
    return [...(this.sets.get(key) ?? [])] as T;
  }

  async srem(key: string, ...members: string[]) {
    this.count("srem");
    const set = this.sets.get(key);
    if (!set) return 0;
    const before = set.size;
    members.forEach((member) => set.delete(member));
    return before - set.size;
  }

  async mget<T>(...keys: string[]) {
    this.count("mget");
    return keys.map((key) => (this.values.get(key) as string | undefined) ?? null) as T;
  }

  async hdel(key: string, ...fields: string[]) {
    this.count("hdel");
    const hash = this.hashes.get(key);
    for (const field of fields) hash?.delete(field);
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
    this.hashes.delete(key);
    this.sets.delete(key);
  }

  async eval(script: string, keys: string[], args: string[]) {
    this.count("eval");
    if (script.includes("ap:create-service")) {
      if (this.values.has(keys[0])) return 0;
      this.values.set(keys[0], args[0]);
      this.hashes.set(keys[1], new Map([["serviceId", args[0]], ["name", args[1]], ["createdAt", args[2]], ["digest", args[3]]]));
      return 1;
    }
    if (script.includes("ap:admit-channel")) {
      const count = Number(this.values.get(keys[0]) ?? 0);
      if (count >= Number(args[1])) return [0, 3600];
      this.values.set(keys[0], count + 1);
      return [1, 3600];
    }
    if (script.includes("ap:bind-service") || script.includes("ap:unbind-service")) {
      const service = this.hashes.get(keys[0]);
      if (service?.get("digest") !== args[0]) return -1;
      const channel = this.values.get(keys[1]);
      if (!channel) return -2;
      let channelSecret: unknown;
      try { channelSecret = JSON.parse(String(channel)).secret; } catch { channelSecret = channel; }
      if (channelSecret !== args[1]) return -3;
      const owner = this.values.get(keys[2]);
      if (script.includes("ap:bind-service")) {
        if (owner) return owner === args[2] ? 1 : -4;
        const set = this.sets.get(keys[3]) ?? new Set<string>();
        if (set.size >= Number(args[3])) return -5;
        set.add(args[4]); this.sets.set(keys[3], set); this.values.set(keys[2], args[2]); return 1;
      }
      if (!owner) return 1;
      if (owner !== args[2]) return -4;
      this.sets.get(keys[3])?.delete(args[4]); this.values.delete(keys[2]); return 1;
    }
    if (script.includes("ap:create-client")) {
      if (!this.values.has(keys[0])) return -1;
      const hash = this.hashes.get(keys[1])!;
      if (hash.get("mode") !== "bearer") return -2;
      const count = Number(hash.get("count") ?? 0);
      if (count >= Number(args[2])) return 0;
      const record = JSON.parse(args[1]);
      hash.set(`c:${args[0]}`, args[1]); hash.set(`d:${args[3]}`, args[1]); hash.set("count", count + 1);
      return 1;
    }
    if (script.includes("ap:revoke-client")) {
      const hash = this.hashes.get(keys[0]);
      const record = hash?.get(`c:${args[0]}`);
      if (!record) return 0;
      const parsed = JSON.parse(String(record));
      hash!.delete(`c:${args[0]}`); hash!.delete(`d:${parsed.digest}`); hash!.set("count", Number(hash!.get("count") ?? 0) - 1);
      return 1;
    }
    const [channel, queue, stats, pending] = keys;
    if (script.includes("ap:admit")) {
      if (!this.values.has(channel)) return -1;
      const n = Number(this.values.get(`${stats}:q`) ?? 0);
      if (n >= Number(args[1])) return 0;
      this.values.set(`${stats}:q`, n + 1); this.values.set(pending, "q");
      const list = this.lists.get(queue) ?? []; list.push(JSON.parse(args[0])); this.lists.set(queue, list); return 1;
    }
    if (script.includes("ap:deliver")) {
      if (!this.values.has(channel)) return -1;
      if (Number(this.values.get(`${stats}:f`) ?? 0) >= Number(args[0])) return "";
      const item = this.lists.get(queue)?.shift(); if (!item) return "";
      this.values.set(`${stats}:q`, Math.max(0, Number(this.values.get(`${stats}:q`) ?? 0) - 1));
      this.values.set(`${stats}:f`, Number(this.values.get(`${stats}:f`) ?? 0) + 1);
      this.values.set(`${pending}${item.id}`, "i"); return JSON.stringify(item);
    }
    if (script.includes("ap:respond")) {
      const state = this.values.get(keys[0]); if (!state) return 0;
      if (state === "q") return 0;
      this.values.delete(keys[0]); const field = state === "q" ? "q" : "f";
      this.values.set(`${keys[1]}:${field}`, Math.max(0, Number(this.values.get(`${keys[1]}:${field}`) ?? 0) - 1));
      this.values.set(keys[2], JSON.parse(args[0])); return 1;
    }
    if (script.includes("ap:cancel")) {
      const hook = this.beforeCancel; this.beforeCancel = undefined; if (hook) await hook();
      const state = this.values.get(keys[0]); if (!state) return this.values.has(keys[3]) ? 2 : 0;
      const field = state === "q" ? "q" : "f";
      if (state === "q") this.lists.set(keys[1], (this.lists.get(keys[1]) ?? []).filter((x) => JSON.stringify(x) !== args[0]));
      this.values.set(`${keys[2]}:${field}`, Math.max(0, Number(this.values.get(`${keys[2]}:${field}`) ?? 0) - 1));
      this.values.delete(keys[0]); return 1;
    }
    throw new Error("unexpected eval");
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

test("Redis broker protects client credential state and enforces lifecycle", async () => {
  const redis = new FakeRedis();
  const broker = new RedisBroker(redis as never);
  const created = await broker.createChannel("client-auth", 10, { mode: "bearer" });
  assert.ok(created.clientCredential);
  await broker.authenticateClient(created.id, created.clientCredential.token);
  const second = await broker.createClientCredential(created.id, created.secret);
  await broker.revokeClientCredential(created.id, created.secret, second.id);
  await assert.rejects(() => broker.authenticateClient(created.id, second.token), /CLIENT_CREDENTIAL_INVALID/);
  assert.notEqual(created.clientCredential.token, created.secret);
});

test("Redis broker returns scoped metadata without storing a raw token", async () => {
  const redis = new FakeRedis();
  const broker = new RedisBroker(redis as never);
  const created = await broker.createChannel("scoped", 10, { mode: "bearer", scopes: [{ methods: ["GET"], path: "/read/*" }] });
  const authenticated = await broker.authenticateClient(created.id, created.clientCredential!.token);
  assert.deepEqual(authenticated?.scopes, [{ methods: ["GET"], path: "/read/*" }]);
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

test("Redis timeout releases queued capacity for a later request", async () => {
  const redis = new FakeRedis();
  const broker = new RedisBroker(redis as never, { maxQueuedPerChannel: 1, maxInFlightPerChannel: 1 });
  const { id, secret } = await broker.createChannel();
  const request = { method: "GET", path: "/", headers: {}, body: null };

  await assert.rejects(broker.dispatch(id, request, 1), /DOWNSTREAM_TIMEOUT/);
  const result = broker.dispatch(id, request, 1_000);
  const pending = await broker.next(id, secret, 100);
  assert.ok(pending);
  await broker.respond(id, secret, pending.id, { statusCode: 200 });
  assert.deepEqual(await result, { statusCode: 200 });
  assert.equal(broker.metrics().queuedRequests + broker.metrics().inFlightRequests, 0);
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

  assert.equal(redis.totalCommands(), 2, "SET + atomic quota admission");
  assert.equal(broker.metrics().redisCommands, 2);
});

test("Redis channel rate limits count successful creations only and return the remaining delay", async () => {
  const redis = new FakeRedis();
  const broker = new RedisBroker(redis as never);
  for (let index = 0; index < 10; index += 1) await broker.createChannel("rate-test");
  await assert.rejects(() => broker.createChannel("rate-test"), { name: "ChannelRateLimitError", retryAfterSeconds: 3600 });
  await assert.rejects(() => broker.createChannel("rate-test"), { name: "ChannelRateLimitError", retryAfterSeconds: 3600 });
});

test("Redis named services use atomic uniqueness, exclusive bindings, and lazy stale pruning", async () => {
  const redis = new FakeRedis();
  const broker = new RedisBroker(redis as never);
  const created = await broker.createService("billing", "service-test", 1_000);
  assert.match(created.secret, /^aps_/);
  assert.equal((await broker.getService("billing"))?.instances.length, 0);
  await assert.rejects(() => broker.createService("billing", "other", 1_000), /SERVICE_NAME_TAKEN/);

  const channel = await broker.createChannel("service-channel", 1_000);
  await broker.bindServiceInstance("billing", created.secret, channel.id, channel.secret);
  await broker.bindServiceInstance("billing", created.secret, channel.id, channel.secret);
  assert.equal((await broker.getService("billing"))?.instances.length, 1);
  await redis.del(`ap:channel:${channel.id}`);
  assert.equal((await broker.getService("billing"))?.instances.length, 0);
  assert.ok((redis.counts.get("mget") ?? 0) >= 1);
});

test("Redis service name creation remains unique under concurrent claims", async () => {
  const broker = new RedisBroker(new FakeRedis() as never);
  const results = await Promise.allSettled(Array.from({ length: 100 }, () => broker.createService("race", "race", 1_000)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && String(result.reason).includes("SERVICE_NAME_TAKEN")).length, 99);
});

test("idle downstream polling is adaptive instead of a 100ms command storm", async () => {
  const redis = new FakeRedis();
  const broker = new RedisBroker(redis as never);
  const { id, secret } = await broker.createChannel("idle-budget");
  const before = redis.totalCommands();

  assert.equal(await broker.next(id, secret, 400), null);

  const commands = redis.totalCommands() - before;
  assert.equal(commands, 4, "GET auth + three atomic capacity-aware polls");
  assert.equal(redis.counts.get("eval"), 4, "one channel-admission script plus three polling scripts");
  assert.equal(broker.metrics().redisPollCommands, 3);
});

test("Redis capacity is shared across instances and a small request uses bounded commands", async () => {
  const redis = new FakeRedis();
  const capacity = { maxQueuedPerChannel: 1, maxInFlightPerChannel: 1 };
  const firstBroker = new RedisBroker(redis as never, capacity);
  const otherBroker = new RedisBroker(redis as never, capacity);
  const { id, secret } = await firstBroker.createChannel();
  const request = { method: "GET", path: "/", headers: {}, body: null };
  const pendingResponse = firstBroker.dispatch(id, request, 1_000);
  await assert.rejects(otherBroker.dispatch(id, request, 10), /BROKER_CAPACITY_EXCEEDED/);
  const item = await otherBroker.next(id, secret, 50);
  assert.ok(item);
  const queued = otherBroker.dispatch(id, request, 1_000);
  assert.equal(await firstBroker.next(id, secret, 20), null, "in-flight cap is shared");
  await otherBroker.respond(id, secret, item.id, { statusCode: 200 });
  await pendingResponse;
  assert.ok(await firstBroker.next(id, secret, 50));
  const before = redis.totalCommands();
  await firstBroker.respond(id, secret, "bad-id", { statusCode: 200 }).catch(() => {});
  assert.ok(redis.totalCommands() - before <= 3, "bad response remains bounded");
  await assert.rejects(queued, /DOWNSTREAM_TIMEOUT/);
});

test("Redis rejects a response for a queued request without leaving a deliverable ghost", async () => {
  const redis = new FakeRedis();
  const broker = new RedisBroker(redis as never);
  const { id, secret } = await broker.createChannel();
  const result = broker.dispatch(id, { method: "GET", path: "/", headers: {}, body: null }, 500);
  const queued = redis.peek(`ap:channel:${id}:requests`);
  assert.ok(queued);
  await assert.rejects(broker.respond(id, secret, queued.id, { statusCode: 200 }), /REQUEST_NOT_FOUND/);
  assert.equal((await broker.next(id, secret, 50))?.id, queued.id);
  await assert.rejects(result, /DOWNSTREAM_TIMEOUT/);
});

test("a response committed at the timeout boundary still completes the request", async () => {
  const redis = new FakeRedis();
  const caller = new RedisBroker(redis as never);
  const downstream = new RedisBroker(redis as never);
  const { id, secret } = await caller.createChannel();
  const response = { statusCode: 201, body: "race" };
  const result = caller.dispatch(id, { method: "GET", path: "/", headers: {}, body: null }, 10);
  redis.beforeCancel = async () => {
    const pending = await downstream.next(id, secret, 50);
    assert.ok(pending);
    await downstream.respond(id, secret, pending.id, response);
  };
  assert.deepEqual(await result, response);
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
