import { randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import { DEFAULT_BROKER_CAPACITY, type Broker, type BrokerCapacity } from "../src/broker.js";
import { ChannelBroker } from "../src/channel-broker.js";
import { RedisBroker } from "../src/redis-broker.js";

// AP_TEST_BROKER=redis runs the HTTP suite against a real Redis reached through
// the Upstash REST API (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
export const testBrokerType = process.env.AP_TEST_BROKER === "redis" ? "redis" : "memory";

export function testBroker(capacity: BrokerCapacity = DEFAULT_BROKER_CAPACITY): Broker {
  if (testBrokerType === "memory") return new ChannelBroker(capacity);
  // A fresh key prefix per broker keeps tests (and parallel test files) from
  // sharing rate limits or channels, as separate memory brokers would.
  return new RedisBroker(Redis.fromEnv({ automaticDeserialization: false }), capacity, `ap-test:${randomUUID()}:`);
}
