import type { Broker } from "./broker.js";
import { ChannelBroker } from "./channel-broker.js";
import { RedisBroker } from "./redis-broker.js";
import { DEFAULT_BROKER_CAPACITY, type BrokerCapacity } from "./broker.js";

export type BrokerMode = "memory" | "redis" | "auto";

function hasRedisConfig() {
  const hasUpstash = Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
  const hasLegacyKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  return hasUpstash || hasLegacyKv;
}

export function createBroker(): Broker {
  const capacity: BrokerCapacity = {
    maxQueuedPerChannel: positiveInt(process.env.AP_BROKER_MAX_QUEUED_PER_CHANNEL, DEFAULT_BROKER_CAPACITY.maxQueuedPerChannel),
    maxInFlightPerChannel: positiveInt(process.env.AP_BROKER_MAX_IN_FLIGHT_PER_CHANNEL, DEFAULT_BROKER_CAPACITY.maxInFlightPerChannel),
  };
  const configured = (process.env.AP_BROKER ?? "auto").trim().toLowerCase();
  if (!(["memory", "redis", "auto"] as const).includes(configured as BrokerMode)) {
    throw new Error(`INVALID_AP_BROKER:${configured}`);
  }

  const mode = configured as BrokerMode;
  if (mode === "memory") return new ChannelBroker(capacity);

  if (mode === "redis") {
    if (!hasRedisConfig()) throw new Error("REDIS_CONFIG_REQUIRED");
    return new RedisBroker(undefined, capacity);
  }

  return hasRedisConfig() ? new RedisBroker(undefined, capacity) : new ChannelBroker(capacity);
}

function positiveInt(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("INVALID_BROKER_CAPACITY");
  return parsed;
}
