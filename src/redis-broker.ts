import { randomBytes, randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import type { Broker, BrokerMetrics, DownstreamResponse, PendingRequest } from "./broker.js";

const CHANNEL_TTL_SECONDS = 15 * 60;
const RESPONSE_TTL_SECONDS = 60;
const CHANNEL_CREATION_WINDOW_SECONDS = 60 * 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class RedisBroker implements Broker {
  private readonly requestStates = new Map<string, "queued" | "inFlight">();
  private queuedRequests = 0;
  private inFlightRequests = 0;

  constructor(private readonly redis = Redis.fromEnv()) {}

  async health() {
    await this.redis.ping();
  }

  metrics(): BrokerMetrics {
    return {
      queuedRequests: this.queuedRequests,
      inFlightRequests: this.inFlightRequests,
    };
  }

  async createChannel(rateLimitKey = "default", limit = 10) {
    const bucket = Math.floor(Date.now() / (CHANNEL_CREATION_WINDOW_SECONDS * 1_000));
    const rateLimitKeyName = `ap:rate:channels:${rateLimitKey}:${bucket}`;
    const count = await this.redis.incr(rateLimitKeyName);
    if (count === 1) await this.redis.expire(rateLimitKeyName, CHANNEL_CREATION_WINDOW_SECONDS);
    if (count > limit) throw new Error("CHANNEL_RATE_LIMITED");

    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    await this.redis.set(this.channelKey(id), secret, { ex: CHANNEL_TTL_SECONDS });
    return { id, secret };
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
    await this.redis.expire(this.channelKey(channelId), CHANNEL_TTL_SECONDS);

    const pending: PendingRequest = { id: randomUUID(), ...request };
    await this.redis.set(this.pendingKey(channelId, pending.id), "1", {
      ex: RESPONSE_TTL_SECONDS,
    });
    await this.redis.rpush(this.queueKey(channelId), pending);
    await this.redis.expire(this.queueKey(channelId), CHANNEL_TTL_SECONDS);
    this.requestStates.set(pending.id, "queued");
    this.queuedRequests += 1;

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

    await this.redis.del(this.pendingKey(channelId, pending.id));
    await this.redis.lrem(this.queueKey(channelId), 1, pending);
    this.removeRequestMetric(pending.id);
    throw new Error("DOWNSTREAM_TIMEOUT");
  }

  async next(channelId: string, secret: string, waitMs = 25_000): Promise<PendingRequest | null> {
    await this.assertChannelSecret(channelId, secret);
    await this.redis.expire(this.channelKey(channelId), CHANNEL_TTL_SECONDS);

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const pending = await this.redis.lpop<PendingRequest>(this.queueKey(channelId));
      if (pending !== null) {
        this.queuedRequests = Math.max(0, this.queuedRequests - 1);
        this.inFlightRequests += 1;
        this.requestStates.set(pending.id, "inFlight");
        return pending;
      }
      await sleep(100);
    }

    return null;
  }

  async respond(channelId: string, secret: string, requestId: string, response: DownstreamResponse) {
    await this.assertChannelSecret(channelId, secret);
    await this.redis.expire(this.channelKey(channelId), CHANNEL_TTL_SECONDS);
    const pendingKey = this.pendingKey(channelId, requestId);
    if ((await this.redis.exists(pendingKey)) !== 1) throw new Error("REQUEST_NOT_FOUND");

    await this.redis.set(this.responseKey(channelId, requestId), response, {
      ex: RESPONSE_TTL_SECONDS,
    });
    await this.redis.del(pendingKey);
    this.removeRequestMetric(requestId);
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

  private pendingKey(channelId: string, requestId: string) {
    return `ap:channel:${channelId}:pending:${requestId}`;
  }

  private removeRequestMetric(requestId: string) {
    const state = this.requestStates.get(requestId);
    if (state === "queued") this.queuedRequests = Math.max(0, this.queuedRequests - 1);
    if (state === "inFlight") this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
    this.requestStates.delete(requestId);
  }

  private async assertChannelSecret(channelId: string, secret: string) {
    const storedSecret = await this.redis.get<string>(this.channelKey(channelId));
    if (storedSecret === null) throw new Error("CHANNEL_NOT_FOUND");
    if (storedSecret !== secret) throw new Error("CHANNEL_UNAUTHORIZED");
  }
}
