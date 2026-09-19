import type { Broker } from "./broker.js";
import { ChannelBroker } from "./channel-broker.js";
import { RedisBroker } from "./redis-broker.js";

export function createBroker(): Broker {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return new RedisBroker();
  }

  return new ChannelBroker();
}
