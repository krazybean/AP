import type { Broker } from "./broker.js";
import { ChannelBroker } from "./channel-broker.js";
import { RedisBroker } from "./redis-broker.js";

export type BrokerMode = "memory" | "redis" | "auto";

function hasRedisConfig() {
  const hasUpstash = Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
  const hasLegacyKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  return hasUpstash || hasLegacyKv;
}

export function createBroker(): Broker {
  const configured = (process.env.AP_BROKER ?? "auto").trim().toLowerCase();
  if (!(["memory", "redis", "auto"] as const).includes(configured as BrokerMode)) {
    throw new Error(`INVALID_AP_BROKER:${configured}`);
  }

  const mode = configured as BrokerMode;
  if (mode === "memory") return new ChannelBroker();

  if (mode === "redis") {
    if (!hasRedisConfig()) throw new Error("REDIS_CONFIG_REQUIRED");
    return new RedisBroker();
  }

  return hasRedisConfig() ? new RedisBroker() : new ChannelBroker();
}
