import { randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import type { Broker, DownstreamResponse, PendingRequest } from "./broker.js";

const CHANNEL_TTL_SECONDS = 60 * 60;
const RESPONSE_TTL_SECONDS = 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class RedisBroker implements Broker {
  constructor(private readonly redis = Redis.fromEnv()) {}

  async createChannel() {
    const id = randomUUID();
    await this.redis.set(this.channelKey(id), "1", { ex: CHANNEL_TTL_SECONDS });
    return id;
  }

  async hasChannel(id: string) {
    return (await this.redis.exists(this.channelKey(id))) === 1;
  }

  async dispatch(
    channelId: string,
    request: Omit<PendingRequest, "id">,
    timeoutMs = 30_000,
  ): Promise<DownstreamResponse> {
    if (!(await this.hasChannel(channelId))) throw new Error("CHANNEL_NOT_FOUND");

    const pending: PendingRequest = { id: randomUUID(), ...request };
    await this.redis.rpush(this.queueKey(channelId), pending);
    await this.redis.expire(this.queueKey(channelId), CHANNEL_TTL_SECONDS);

    const responseKey = this.responseKey(channelId, pending.id);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await this.redis.get<DownstreamResponse>(responseKey);
      if (response !== null) {
        await this.redis.del(responseKey);
        return response;
      }
      await sleep(100);
    }

    throw new Error("DOWNSTREAM_TIMEOUT");
  }

  async next(channelId: string, waitMs = 25_000): Promise<PendingRequest | null> {
    if (!(await this.hasChannel(channelId))) throw new Error("CHANNEL_NOT_FOUND");

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const pending = await this.redis.lpop<PendingRequest>(this.queueKey(channelId));
      if (pending !== null) return pending;
      await sleep(100);
    }

    return null;
  }

  async respond(channelId: string, requestId: string, response: DownstreamResponse) {
    if (!(await this.hasChannel(channelId))) throw new Error("CHANNEL_NOT_FOUND");

    await this.redis.set(this.responseKey(channelId, requestId), response, {
      ex: RESPONSE_TTL_SECONDS,
    });
  }

  private channelKey(channelId: string) {
    return `ap:channel:${channelId}`;
  }

  private queueKey(channelId: string) {
    return `ap:channel:${channelId}:requests`;
  }

  private responseKey(channelId: string, requestId: string) {
    return `ap:channel:${channelId}:response:${requestId}`;
  }
}
