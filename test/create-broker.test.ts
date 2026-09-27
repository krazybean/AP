import assert from "node:assert/strict";
import { test } from "node:test";

import { createBroker } from "../src/create-broker.js";

const ENV_KEYS = [
  "AP_BROKER",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const;

function withCleanBrokerEnv(run: () => void) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  try {
    run();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("AP_BROKER=memory ignores Redis credentials", () => {
  withCleanBrokerEnv(() => {
    process.env.AP_BROKER = "memory";
    process.env.UPSTASH_REDIS_REST_URL = "https://example.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    assert.equal(createBroker().type, "memory");
  });
});

test("AP_BROKER=redis requires Redis credentials", () => {
  withCleanBrokerEnv(() => {
    process.env.AP_BROKER = "redis";
    assert.throws(() => createBroker(), /REDIS_CONFIG_REQUIRED/);
  });
});

test("AP_BROKER=redis selects Redis when configured", () => {
  withCleanBrokerEnv(() => {
    process.env.AP_BROKER = "redis";
    process.env.UPSTASH_REDIS_REST_URL = "https://example.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    assert.equal(createBroker().type, "redis");
  });
});

test("auto preserves backwards-compatible broker discovery", () => {
  withCleanBrokerEnv(() => {
    assert.equal(createBroker().type, "memory");
    process.env.UPSTASH_REDIS_REST_URL = "https://example.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    assert.equal(createBroker().type, "redis");
  });
});
