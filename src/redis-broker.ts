import { randomBytes, randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import {
  BrokerUnavailableError,
  BrokerCapacityError,
  DEFAULT_BROKER_CAPACITY,
  type BrokerCapacity,
  type Broker,
  type BrokerMetrics,
  type DownstreamResponse,
  type PendingRequest,
  type ExposureConfig,
} from "./broker.js";
import { CLIENT_CREDENTIAL_LIMIT, createClientCredential, digestToken, type ClientCredentialMetadata } from "./client-credentials.js";
import { validateScopes, type ClientScope } from "./client-scopes.js";

const CHANNEL_TTL_SECONDS = 15 * 60;
const RESPONSE_TTL_SECONDS = CHANNEL_TTL_SECONDS;
const CHANNEL_CREATION_WINDOW_SECONDS = 60 * 60;
const POLL_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 5_000] as const;

const ADMIT = `-- ap:admit
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
redis.call('EXPIRE', KEYS[1], ARGV[3])
local q = tonumber(redis.call('HGET', KEYS[3], 'q') or '0')
if q >= tonumber(ARGV[2]) then return 0 end
redis.call('HINCRBY', KEYS[3], 'q', 1); redis.call('SET', KEYS[4], 'q', 'EX', ARGV[3])
redis.call('RPUSH', KEYS[2], ARGV[1]); redis.call('EXPIRE', KEYS[2], ARGV[3]); redis.call('EXPIRE', KEYS[3], ARGV[3]); return 1`;
const DELIVER = `-- ap:deliver
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
redis.call('EXPIRE', KEYS[1], ARGV[2])
local f = tonumber(redis.call('HGET', KEYS[3], 'f') or '0'); if f >= tonumber(ARGV[1]) then return '' end
local item = redis.call('LPOP', KEYS[2]); if not item then return '' end
local id = cjson.decode(item).id; redis.call('HINCRBY', KEYS[3], 'q', -1); redis.call('HINCRBY', KEYS[3], 'f', 1)
redis.call('SET', KEYS[4] .. id, 'i', 'EX', ARGV[2]); redis.call('EXPIRE', KEYS[3], ARGV[2]); return item`;
const RESPOND = `-- ap:respond
local state = redis.call('GET', KEYS[1]); if not state or state == 'q' then return 0 end
redis.call('DEL', KEYS[1]); redis.call('HINCRBY', KEYS[2], state == 'q' and 'q' or 'f', -1)
redis.call('SET', KEYS[3], ARGV[1], 'EX', ARGV[2]); redis.call('EXPIRE', KEYS[2], ARGV[2]); return 1`;
const CANCEL = `-- ap:cancel
local state = redis.call('GET', KEYS[1]); if not state then if redis.call('EXISTS', KEYS[4]) == 1 then return 2 else return 0 end end
if state == 'q' then redis.call('LREM', KEYS[2], 1, ARGV[1]); redis.call('HINCRBY', KEYS[3], 'q', -1) else redis.call('HINCRBY', KEYS[3], 'f', -1) end
redis.call('DEL', KEYS[1]); redis.call('EXPIRE', KEYS[3], ARGV[2]); return 1`;
const CREATE_CLIENT = `-- ap:create-client
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
if redis.call('HGET', KEYS[2], 'mode') ~= 'bearer' then return -2 end
local count = tonumber(redis.call('HGET', KEYS[2], 'count') or '0'); for _, key in ipairs(redis.call('HKEYS', KEYS[2])) do if string.sub(key, 1, 2) == 'c:' then local item = cjson.decode(redis.call('HGET', KEYS[2], key)); if item.expiresAt and item.expiresAt <= tonumber(ARGV[6]) then redis.call('HDEL', KEYS[2], key, 'd:' .. item.digest); count = count - 1 end end end; redis.call('HSET', KEYS[2], 'count', count); if count >= tonumber(ARGV[3]) then return 0 end
redis.call('HSET', KEYS[2], 'c:' .. ARGV[1], ARGV[2], 'd:' .. ARGV[4], ARGV[2]); redis.call('HINCRBY', KEYS[2], 'count', 1); redis.call('EXPIRE', KEYS[2], ARGV[5]); return 1`;
const REVOKE_CLIENT = `-- ap:revoke-client
local record = redis.call('HGET', KEYS[1], 'c:' .. ARGV[1]); if not record then return 0 end
local parsed = cjson.decode(record); redis.call('HDEL', KEYS[1], 'c:' .. ARGV[1], 'd:' .. parsed.digest); redis.call('HINCRBY', KEYS[1], 'count', -1); return 1`;

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

  constructor(private readonly redis = Redis.fromEnv(), private readonly capacity: BrokerCapacity = DEFAULT_BROKER_CAPACITY) {}

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

  async createChannel(rateLimitKey = "default", limit = 10, access: import("./broker.js").AccessConfig = { mode: "public" }, exposure: ExposureConfig = { mode: "path" }) {
    const bucket = Math.floor(Date.now() / (CHANNEL_CREATION_WINDOW_SECONDS * 1_000));
    const rateLimitKeyName = `ap:rate:channels:${rateLimitKey}:${bucket}`;
    const count = await this.command(() => this.redis.incr(rateLimitKeyName));
    if (count === 1) {
      await this.command(() => this.redis.expire(rateLimitKeyName, CHANNEL_CREATION_WINDOW_SECONDS));
    }
    if (count > limit) throw new Error("CHANNEL_RATE_LIMITED");

    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    await this.command(() => this.redis.set(this.channelKey(id), JSON.stringify({ secret, accessMode: access.mode, exposureMode: exposure.mode }), { ex: CHANNEL_TTL_SECONDS }));
    if (access.mode === "public") return { id, secret, accessMode: "public" as const, exposureMode: exposure.mode };
    await this.command(() => this.redis.hset(this.accessKey(id), { mode: "bearer", count: 0 }));
    await this.command(() => this.redis.expire(this.accessKey(id), CHANNEL_TTL_SECONDS));
    const clientCredential = await this.createClientCredential(id, secret, undefined, validateScopes(access.scopes));
    return { id, secret, accessMode: "bearer" as const, exposureMode: exposure.mode, clientCredential };
  }

  async authenticateClient(channelId: string, token: string) {
    const stored = await this.command(() => this.redis.get<string>(this.channelKey(channelId)));
    if (stored === null) throw new Error("CHANNEL_NOT_FOUND");
    const channel = this.parseChannel(stored);
    if (channel.accessMode !== "bearer") return undefined;
    const record = await this.command(() => this.redis.hget<string>(this.accessKey(channelId), `d:${digestToken(token).toString("hex")}`));
    if (!record) throw new Error("CLIENT_CREDENTIAL_INVALID");
    const metadata = JSON.parse(record) as ClientCredentialMetadata & { digest: string };
    if (metadata.expiresAt !== undefined && metadata.expiresAt <= Date.now()) throw new Error("CLIENT_CREDENTIAL_EXPIRED");
    await this.command(() => this.redis.expire(this.channelKey(channelId), CHANNEL_TTL_SECONDS));
    await this.command(() => this.redis.expire(this.accessKey(channelId), CHANNEL_TTL_SECONDS));
    return { id: metadata.id, createdAt: metadata.createdAt, ...(metadata.expiresAt === undefined ? {} : { expiresAt: metadata.expiresAt }), ...(metadata.scopes ? { scopes: metadata.scopes } : {}) };
  }

  async createClientCredential(channelId: string, secret: string, expiresAt?: number, scopes?: ClientScope[]) {
    await this.assertChannelSecret(channelId, secret);
    if (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) throw new Error("CLIENT_CREDENTIAL_EXPIRY_INVALID");
    const generated = createClientCredential(validateScopes(scopes));
    const metadata = { id: generated.id, createdAt: generated.createdAt, ...(expiresAt === undefined ? {} : { expiresAt }), ...(scopes ? { scopes } : {}), digest: generated.digest.toString("hex") };
    const result = await this.command(() => this.redis.eval<[string, string, string, string, string, string], number>(CREATE_CLIENT,
      [this.channelKey(channelId), this.accessKey(channelId)], [generated.id, JSON.stringify(metadata), String(CLIENT_CREDENTIAL_LIMIT), metadata.digest, String(CHANNEL_TTL_SECONDS), String(Date.now())]));
    if (result === -1) throw new Error("CHANNEL_NOT_FOUND");
    if (result === -2) throw new Error("CLIENT_ACCESS_NOT_ENABLED");
    if (result === 0) throw new Error("CLIENT_CREDENTIAL_LIMIT");
    await this.command(() => this.redis.expire(this.channelKey(channelId), CHANNEL_TTL_SECONDS));
    return { id: generated.id, token: generated.token, createdAt: generated.createdAt, ...(expiresAt === undefined ? {} : { expiresAt }), ...(scopes ? { scopes } : {}) };
  }

  async revokeClientCredential(channelId: string, secret: string, credentialId: string) {
    await this.assertChannelSecret(channelId, secret);
    const result = await this.command(() => this.redis.eval<[string], number>(REVOKE_CLIENT,
      [this.accessKey(channelId)], [credentialId]));
    if (result === 0) throw new Error("CLIENT_CREDENTIAL_NOT_FOUND");
    await this.command(() => this.redis.expire(this.accessKey(channelId), CHANNEL_TTL_SECONDS));
  }

  async hasChannel(id: string) {
    return (await this.command(() => this.redis.exists(this.channelKey(id)))) === 1;
  }

  async channelExposure(id: string) {
    const stored = await this.command(() => this.redis.get<string>(this.channelKey(id)));
    return stored === null ? null : this.parseChannel(stored).exposureMode;
  }

  async dispatch(
    channelId: string,
    request: Omit<PendingRequest, "id">,
    timeoutMs = 30_000,
  ): Promise<DownstreamResponse> {
    const pending: PendingRequest = { id: randomUUID(), ...request };
    const admitted = await this.command(() => this.redis.eval<[string, string, string], number>(ADMIT,
      [this.channelKey(channelId), this.queueKey(channelId), this.statsKey(channelId), this.pendingKey(channelId, pending.id)],
      [JSON.stringify(pending), String(this.capacity.maxQueuedPerChannel), String(CHANNEL_TTL_SECONDS)]));
    if (admitted === -1) throw new Error("CHANNEL_NOT_FOUND");
    if (admitted === 0) throw new BrokerCapacityError();
    this.requestStates.set(pending.id, "queued");
    this.queuedRequests += 1;

    const responseKey = this.responseKey(channelId, pending.id);
    const deadline = Date.now() + timeoutMs;
    let pollIndex = 0;
    try {
      while (Date.now() < deadline) {
        const response = await this.command(
          () => this.redis.get<DownstreamResponse>(responseKey),
          true,
        );
        if (response !== null) {
          await this.command(() => this.redis.del(responseKey));
          this.removeRequestMetric(pending.id);
          return response;
        }
        await this.pollDelay(deadline, pollIndex++);
      }

      const cancelled = await this.command(() => this.redis.eval<[string, string], number>(CANCEL,
        [this.pendingKey(channelId, pending.id), this.queueKey(channelId), this.statsKey(channelId), responseKey],
        [JSON.stringify(pending), String(CHANNEL_TTL_SECONDS)]));
      this.removeRequestMetric(pending.id);
      if (cancelled === 2) {
        const response = await this.command(() => this.redis.get<DownstreamResponse>(responseKey));
        if (response !== null) {
          await this.command(() => this.redis.del(responseKey));
          return response;
        }
      }
      throw new Error("DOWNSTREAM_TIMEOUT");
    } catch (error) {
      this.removeRequestMetric(pending.id);
      if (error instanceof Error && error.message === "DOWNSTREAM_TIMEOUT") throw error;
      try {
        await this.command(() => this.redis.eval<[string, string], number>(CANCEL,
          [this.pendingKey(channelId, pending.id), this.queueKey(channelId), this.statsKey(channelId), responseKey],
          [JSON.stringify(pending), String(CHANNEL_TTL_SECONDS)]));
      } catch (cleanupError) {
        const failures = new AggregateError([error, cleanupError], "BROKER_DISPATCH_CLEANUP_FAILED", { cause: error });
        throw new BrokerUnavailableError("BROKER_UNAVAILABLE", retryAfterSeconds(cleanupError), { cause: failures });
      }
      throw error;
    }
  }

  async next(channelId: string, secret: string, waitMs = 25_000): Promise<PendingRequest | null> {
    const channel = await this.assertChannelSecret(channelId, secret);
    if (channel.accessMode === "bearer") await this.touchAccess(channelId);

    const deadline = Date.now() + waitMs;
    let pollIndex = 0;
    while (Date.now() < deadline) {
      const rawPending = await this.command(() => this.redis.eval<[string, string], string | number>(DELIVER,
        [this.channelKey(channelId), this.queueKey(channelId), this.statsKey(channelId), this.pendingPrefix(channelId)],
        [String(this.capacity.maxInFlightPerChannel), String(CHANNEL_TTL_SECONDS)]), true);
      if (typeof rawPending === "number") throw new Error("CHANNEL_NOT_FOUND");
      if (rawPending) {
        const pending = typeof rawPending === "string" ? JSON.parse(rawPending) as PendingRequest : rawPending as PendingRequest;
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
    const channel = await this.assertChannelSecret(channelId, secret);
    if (channel.accessMode === "bearer") await this.touchAccess(channelId);
    await this.command(() => this.redis.expire(this.channelKey(channelId), CHANNEL_TTL_SECONDS));
    const result = await this.command(() => this.redis.eval<[string, string], number>(RESPOND,
      [this.pendingKey(channelId, requestId), this.statsKey(channelId), this.responseKey(channelId, requestId)],
      [JSON.stringify(response), String(RESPONSE_TTL_SECONDS)]));
    if (result === 0) throw new Error("REQUEST_NOT_FOUND");
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

  private pendingPrefix(channelId: string) { return `ap:channel:${channelId}:pending:`; }
  private statsKey(channelId: string) { return `ap:channel:${channelId}:capacity`; }
  private accessKey(channelId: string) { return `ap:channel:${channelId}:access`; }

  private removeRequestMetric(requestId: string) {
    const state = this.requestStates.get(requestId);
    if (state === "queued") this.queuedRequests = Math.max(0, this.queuedRequests - 1);
    if (state === "inFlight") this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
    this.requestStates.delete(requestId);
  }

  private async assertChannelSecret(channelId: string, secret: string) {
    const storedSecret = await this.command(() => this.redis.get<string>(this.channelKey(channelId)));
    if (storedSecret === null) throw new Error("CHANNEL_NOT_FOUND");
    const channel = this.parseChannel(storedSecret);
    if (channel.secret !== secret) throw new Error("CHANNEL_UNAUTHORIZED");
    return channel;
  }

  private async touchAccess(channelId: string) {
    await this.command(() => this.redis.expire(this.accessKey(channelId), CHANNEL_TTL_SECONDS));
  }

  private parseChannel(value: string) {
    try {
      const parsed = JSON.parse(value) as { secret?: unknown; accessMode?: unknown; exposureMode?: unknown };
      if (typeof parsed.secret === "string") return { secret: parsed.secret, accessMode: parsed.accessMode === "bearer" ? "bearer" : "public", exposureMode: parsed.exposureMode === "isolated-host" ? "isolated-host" : "path" } as const;
    } catch {}
    return { secret: value, accessMode: "public" as const, exposureMode: "path" as const };
  }
}
