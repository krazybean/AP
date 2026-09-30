import { randomBytes, randomUUID } from "node:crypto";

import { BrokerCapacityError, DEFAULT_BROKER_CAPACITY, type AccessConfig, type Broker, type BrokerCapacity, type BrokerMetrics, type DownstreamResponse, type PendingRequest } from "./broker.js";
import { CLIENT_CREDENTIAL_LIMIT, createClientCredential, tokenDigestsMatch, type ClientCredentialMetadata } from "./client-credentials.js";
import { validateScopes } from "./client-scopes.js";

interface PendingExchange {
  request: PendingRequest;
  resolve: (response: DownstreamResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface Channel {
  id: string;
  secret: string;
  expiresAt: number;
  queue: PendingExchange[];
  waiters: Array<(request: PendingRequest | null) => void>;
  accessMode: "public" | "bearer";
  credentials: Map<string, { metadata: ClientCredentialMetadata; digest: Buffer }>;
}

interface CreationLimit {
  count: number;
  expiresAt: number;
}

const CHANNEL_CREATION_WINDOW_MS = 60 * 60 * 1_000;
const CHANNEL_TTL_MS = 15 * 60 * 1_000;

export class ChannelBroker implements Broker {
  readonly type = "memory" as const;
  private readonly channels = new Map<string, Channel>();
  private readonly creationLimits = new Map<string, CreationLimit>();

  constructor(private readonly capacity: BrokerCapacity = DEFAULT_BROKER_CAPACITY) {}

  async health() {}

  metrics(): BrokerMetrics {
    let queuedRequests = 0;
    let inFlightRequests = 0;
    for (const channel of this.channels.values()) {
      for (const exchange of channel.queue) {
        if ((exchange.request as PendingRequest & { delivered?: boolean }).delivered) inFlightRequests += 1;
        else queuedRequests += 1;
      }
    }
    return { queuedRequests, inFlightRequests };
  }

  async createChannel(rateLimitKey = "default", limit = 10, access: AccessConfig = { mode: "public" }) {
    const now = Date.now();
    const current = this.creationLimits.get(rateLimitKey);
    const window = current && current.expiresAt > now
      ? current
      : { count: 0, expiresAt: now + CHANNEL_CREATION_WINDOW_MS };
    if (window.count >= limit) throw new Error("CHANNEL_RATE_LIMITED");
    window.count += 1;
    this.creationLimits.set(rateLimitKey, window);

    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const channel: Channel = {
      id,
      secret,
      expiresAt: Date.now() + CHANNEL_TTL_MS,
      queue: [],
      waiters: [],
      accessMode: access.mode,
      credentials: new Map(),
    };
    this.channels.set(id, channel);
    const clientCredential = access.mode === "bearer" ? this.addCredential(channel, undefined, access.scopes) : undefined;
    return { id, secret, accessMode: access.mode, ...(clientCredential ? { clientCredential } : {}) };
  }

  async authenticateClient(channelId: string, token: string) {
    const channel = this.getChannel(channelId);
    if (!channel) throw new Error("CHANNEL_NOT_FOUND");
    if (channel.accessMode === "public") return undefined;
    for (const credential of channel.credentials.values()) {
      if (!tokenDigestsMatch(token, credential.digest)) continue;
      if (credential.metadata.expiresAt !== undefined && credential.metadata.expiresAt <= Date.now()) {
        throw new Error("CLIENT_CREDENTIAL_EXPIRED");
      }
      channel.expiresAt = Date.now() + CHANNEL_TTL_MS;
      return credential.metadata;
    }
    throw new Error("CLIENT_CREDENTIAL_INVALID");
  }

  async createClientCredential(channelId: string, secret: string, expiresAt?: number, scopes?: import("./client-scopes.js").ClientScope[]) {
    const channel = this.getChannel(channelId);
    if (!channel) throw new Error("CHANNEL_NOT_FOUND");
    if (channel.secret !== secret) throw new Error("CHANNEL_UNAUTHORIZED");
    if (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) throw new Error("CLIENT_CREDENTIAL_EXPIRY_INVALID");
    const credential = this.addCredential(channel, expiresAt, validateScopes(scopes));
    channel.expiresAt = Date.now() + CHANNEL_TTL_MS;
    return credential;
  }

  async revokeClientCredential(channelId: string, secret: string, credentialId: string) {
    const channel = this.getChannel(channelId);
    if (!channel) throw new Error("CHANNEL_NOT_FOUND");
    if (channel.secret !== secret) throw new Error("CHANNEL_UNAUTHORIZED");
    if (!channel.credentials.delete(credentialId)) throw new Error("CLIENT_CREDENTIAL_NOT_FOUND");
    channel.expiresAt = Date.now() + CHANNEL_TTL_MS;
  }

  async hasChannel(id: string) {
    return this.getChannel(id) !== undefined;
  }

  async dispatch(
    channelId: string,
    request: Omit<PendingRequest, "id">,
    timeoutMs = 30_000,
  ): Promise<DownstreamResponse> {
    const channel = this.getChannel(channelId);
    if (!channel) throw new Error("CHANNEL_NOT_FOUND");
    if (channel.queue.filter((item) => !(item.request as PendingRequest & { delivered?: boolean }).delivered).length >= this.capacity.maxQueuedPerChannel) throw new BrokerCapacityError();
    channel.expiresAt = Date.now() + CHANNEL_TTL_MS;

    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const exchange: PendingExchange = {
        request: { id, ...request },
        resolve,
        reject,
        timeout: setTimeout(() => {
          channel.queue = channel.queue.filter((item) => item.request.id !== id);
          reject(new Error("DOWNSTREAM_TIMEOUT"));
          this.deliver(channel);
        }, timeoutMs),
      };

      channel.queue.push(exchange);
      this.deliver(channel);
    });
  }

  async next(channelId: string, secret: string, waitMs = 25_000): Promise<PendingRequest | null> {
    const channel = this.getChannel(channelId);
    if (!channel) throw new Error("CHANNEL_NOT_FOUND");
    if (channel.secret !== secret) throw new Error("CHANNEL_UNAUTHORIZED");
    channel.expiresAt = Date.now() + CHANNEL_TTL_MS;

    const inFlight = channel.queue.filter((item) => (item.request as PendingRequest & { delivered?: boolean }).delivered).length;
    const next = inFlight < this.capacity.maxInFlightPerChannel
      ? channel.queue.find((item) => !(item.request as PendingRequest & { delivered?: boolean }).delivered)
      : undefined;
    if (next) {
      (next.request as PendingRequest & { delivered?: boolean }).delivered = true;
      return next.request;
    }

    return new Promise((resolve) => {
      const waiter = (request: PendingRequest | null) => {
        resolve(request);
      };
      channel.waiters.push(waiter);
      setTimeout(() => {
        const index = channel.waiters.indexOf(waiter);
        if (index >= 0) channel.waiters.splice(index, 1);
        resolve(null);
      }, waitMs);
    });
  }

  async respond(channelId: string, secret: string, requestId: string, response: DownstreamResponse) {
    const channel = this.getChannel(channelId);
    if (!channel) throw new Error("CHANNEL_NOT_FOUND");
    if (channel.secret !== secret) throw new Error("CHANNEL_UNAUTHORIZED");
    channel.expiresAt = Date.now() + CHANNEL_TTL_MS;

    const index = channel.queue.findIndex((item) => item.request.id === requestId);
    if (index < 0 || !(channel.queue[index].request as PendingRequest & { delivered?: boolean }).delivered) throw new Error("REQUEST_NOT_FOUND");

    const [exchange] = channel.queue.splice(index, 1);
    clearTimeout(exchange.timeout);
    exchange.resolve(response);
    this.deliver(channel);
  }

  private getChannel(id: string) {
    const channel = this.channels.get(id);
    if (channel && channel.expiresAt <= Date.now()) {
      this.channels.delete(id);
      return undefined;
    }
    return channel;
  }

  private addCredential(channel: Channel, expiresAt?: number, scopes?: import("./client-scopes.js").ClientScope[]) {
    for (const [id, credential] of channel.credentials) {
      if (credential.metadata.expiresAt !== undefined && credential.metadata.expiresAt <= Date.now()) channel.credentials.delete(id);
    }
    if (channel.credentials.size >= CLIENT_CREDENTIAL_LIMIT) throw new Error("CLIENT_CREDENTIAL_LIMIT");
    const generated = createClientCredential(scopes);
    const metadata: ClientCredentialMetadata = { id: generated.id, createdAt: generated.createdAt, ...(expiresAt === undefined ? {} : { expiresAt }), ...(scopes ? { scopes } : {}) };
    channel.credentials.set(metadata.id, { metadata, digest: generated.digest });
    return { id: metadata.id, token: generated.token, createdAt: metadata.createdAt, ...(expiresAt === undefined ? {} : { expiresAt }), ...(scopes ? { scopes } : {}) };
  }

  private deliver(channel: Channel) {
    while (channel.waiters.length && channel.queue.filter((item) => (item.request as PendingRequest & { delivered?: boolean }).delivered).length < this.capacity.maxInFlightPerChannel) {
      const next = channel.queue.find((item) => !(item.request as PendingRequest & { delivered?: boolean }).delivered);
      if (!next) return;
      (next.request as PendingRequest & { delivered?: boolean }).delivered = true;
      channel.waiters.shift()!(next.request);
    }
  }
}
