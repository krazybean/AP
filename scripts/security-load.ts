import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import Fastify from "fastify";
import { BrokerCapacityError, type Broker } from "../src/broker.js";
import { registerRoutes } from "../src/routes.js";

const channel = "c0a80101-0000-4000-8000-000000000001";
const broker = {
  type: "memory" as const,
  health: async () => {},
  metrics: () => ({ queuedRequests: 0, inFlightRequests: 0 }),
  createChannel: async () => ({ id: channel, secret: "load-test-secret" }),
  hasChannel: async () => true,
  dispatch: async (id: string) => {
    if (id !== channel) throw new Error("CHANNEL_NOT_FOUND");
    throw new BrokerCapacityError();
  },
  next: async () => null,
  respond: async () => {},
} satisfies Broker;

const app = Fastify({ logger: false });
registerRoutes(app, broker);
const start = performance.now();
const unknown = await Promise.all(Array.from({ length: 200 }, (_, i) =>
  app.inject({ method: "GET", url: `/c/00000000-0000-4000-8000-${String(i).padStart(12, "0")}` })));
const known = await Promise.all(Array.from({ length: 200 }, () =>
  app.inject({ method: "GET", url: `/c/${channel}/health` })));
const oversized = await app.inject({ method: "POST", url: "/channels", headers: { "content-type": "application/json" }, payload: JSON.stringify("x".repeat(1_048_577)) });
await app.close();

assert.deepEqual([...new Set(unknown.map((response) => response.statusCode))], [404]);
assert.ok(known.every((response) => response.statusCode === 429));
assert.equal(oversized.statusCode, 413);
const elapsedMs = Math.round(performance.now() - start);
console.log(JSON.stringify({ unknown: unknown.length, known: known.length, oversized: oversized.statusCode, elapsedMs }));
