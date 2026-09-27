import { randomBytes, randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import {
  BrokerUnavailableError,
  type Broker,
  type BrokerMetrics,
  type DownstreamResponse,
  type PendingRequest,
} from "./broker.js";

const CHANNEL_TTL_SECONDS = 15 * 60;
const RESPONSE_TTL_SECONDS = 60;
const CHANNEL_CREATION_WINDOW_SECONDS = 60 * 60;
const POLL_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 5_000] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterSeconds(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    retryAfter?: unknown;
    retryAfterSeconds?: unknown;
    headers?: { get?: (name: string) => string | null };
  };
  const raw = candidate.retryAfterSeconds ?? candidate.retryAfter ?? candidate.headers?.get?.("retry-after");
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.ceil(value) : undefined;
}

function isInfrastructureError(error: unknown) {
  if (!(error instanceof Error)) return true;
  const message = error.message.toLowerCase();
  return message.includes("max requests limit exceeded") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("fetch failed") ||
    message.includes("econn") ||
    message.includes("timeout") ||
    message.includes("unavailable") ||
    error.name === "TimeoutError";
}

export class RedisBroker implements Broker {
  readonly type = "redis" as const;
  private readonly requestStates = new Map<string, "queued" | "inFlight">();
  private queuedRequests = 0;
  private inFlightRequests = 0;
  private redisCommands = 0;
  private redisPollCommands = 0;

  constructor(private readonly redis = Redis.fromEnv()) {}

  async health() {
    await this.command(() => this.redis.ping());
  }

  metrics(): BrokerMetrics {
    return {
      queuedRequests: this.queuedRequests,
      inFlightRequests: this.inFlightRequests,
      redisCommands: this.redisCommands,
      redisPollCommands: this.redisPollCommands,
    };
  }

  async createChannel(rateLimitKey = "default", limit = 10) {
    const bucket = Math.floor(Date.now() / (CHANNEL_CREATION_WINDOW_SECONDS * 1_000));
    const rateLimitKeyName = `ap:rate:channels:${rateLimitKey}:${bucket}`;
    const count = await this.command(() => this.redis.incr(rateLimitKeyName));
    if (count === 1) {
      await this.command(() => this.redis.expire(rateLimitKeyName, CHANNEL_CREATION_WINDOW_SECONDS));
    }
    if (count > limit) throw new Error("CHANNEL_RATE_LIMITED");

    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    await this.command(() => this.redis.set(this.channelKey(id), secret, { ex: CHANNEL_TTL_SECONDS }));
    return { id, secret };
  }

  async hasChannel(id: string) {
    return (await this.command(() => this.redis.exists(this.channelKey(id)))) === 1;
  }

  async dispatch(
    channelId: string,
    request: Omit<PendingRequest, "id">,
    timeoutMs = 30_000,
  ): Promise<DownstreamResponse> {
    const channelSecret = await this.command(() => this.redis.get<string>(this.channelKey(channelId)));
    if (channelSecret === null) throw new Error("CHANNEL_NOT_FOUND");
    await this.command(() => this.redis.expire(this.channelKey(channelId), CHANNEL_TTL_SECONDS));

    const pending: PendingRequest = { id: randomUUID(), ...request };
    await this.command(() => this.redis.set(this.pendingKey(channelId, pending.id), "1", {
      ex: RESPONSE_TTL_SECONDS,
    }));
    await this.command(() => this.redis.rpush(this.queueKey(channelId), pending));
    await this.command(() => this.redis.expire(this.queueKey(channelId), CHANNEL_TTL_SECONDS));
    this.requestStates.set(pending.id, "queued");
    this.queuedRequests += 1;

    const responseKey = this.responseKey(channelId, pending.id);
    const deadline = Date.now() + timeoutMs;
    let pollIndex = 0;

    while (Date.now() < deadline) {
      const response = await this.command(
        () => this.redis.get<DownstreamResponse>(responseKey),
        true,
      );
      if (response !== null) {
        await this.command(() => this.redis.del(responseKey));
        return response;
      }
      await this.pollDelay(deadline, pollIndex++);
    }

    await this.command(() => this.redis.del(this.pendingKey(channelId, pending.id)));
    await this.command(() => this.redis.lrem(this.queueKey(channelId), 1, pending));
    this.removeRequestMetric(pending.id);
    throw new Error("DOWNSTREAM_TIMEOUT");
  }

  async next(channelId: string, secret: string, waitMs = 25_000): Promise<PendingRequest | null> {
    await this.assertChannelSecret(channelId, secret);
    await this.command(() => this.redis.expire(this.channelKey(channelId), CHANNEL_TTL_SECONDS));

    const deadline = Date.now() + waitMs;
    let pollIndex = 0;
    while (Date.now() < deadline) {
      const pending = await this.command(
        () => this.redis.lpop<PendingRequest>(this.queueKey(channelId)),
        true,
      );
      if (pending !== null) {
        this.queuedRequests = Math.max(0, this.queuedRequests - 1);
        this.inFlightRequests += 1;
        this.requestStates.set(pending.id, "inFlight");
        return pending;
      }
      await this.pollDelay(deadline, pollIndex++);
    }

    return null;
  }

  async respond(channelId: string, secret: string, requestId: string, response: DownstreamResponse) {
    await this.assertChannelSecret(channelId, secret);
    await this.command(() => this.redis.expire(this.channelKey(channelId), CHANNEL_TTL_SECONDS));
    const pendingKey = this.pendingKey(channelId, requestId);
    if ((await this.command(() => this.redis.exists(pendingKey))) !== 1) {
      throw new Error("REQUEST_NOT_FOUND");
    }

    await this.command(() => this.redis.set(this.responseKey(channelId, requestId), response, {
      ex: RESPONSE_TTL_SECONDS,
    }));
    await this.command(() => this.redis.del(pendingKey));
    this.removeRequestMetric(requestId);
  }

  private async pollDelay(deadline: number, pollIndex: number) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    const delay = POLL_DELAYS_MS[Math.min(pollIndex, POLL_DELAYS_MS.length - 1)];
    await sleep(Math.min(delay, remaining));
  }

  private async command<T>(operation: () => Promise<T>, poll = false): Promise<T> {
    this.redisCommands += 1;
    if (poll) this.redisPollCommands += 1;
    try {
      return await operation();
    } catch (error) {
      if (error instanceof BrokerUnavailableError) throw error;
      if (isInfrastructureError(error)) {
        throw new BrokerUnavailableError("BROKER_UNAVAILABLE", retryAfterSeconds(error));
      }
      throw error;
    }
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
    const storedSecret = await this.command(() => this.redis.get<string>(this.channelKey(channelId)));
    if (storedSecret === null) throw new Error("CHANNEL_NOT_FOUND");
    if (storedSecret !== secret) throw new Error("CHANNEL_UNAUTHORIZED");
  }
}
