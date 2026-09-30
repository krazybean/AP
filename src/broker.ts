export interface PendingRequest {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface DownstreamResponse {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface BrokerMetrics {
  queuedRequests: number;
  inFlightRequests: number;
  redisCommands?: number;
  redisPollCommands?: number;
}

export interface BrokerCapacity { maxQueuedPerChannel: number; maxInFlightPerChannel: number }
export const DEFAULT_BROKER_CAPACITY: BrokerCapacity = { maxQueuedPerChannel: 100, maxInFlightPerChannel: 20 };

export class BrokerUnavailableError extends Error {
  constructor(message = "BROKER_UNAVAILABLE", readonly retryAfterSeconds?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrokerUnavailableError";
  }
}

export class BrokerCapacityError extends Error {
  constructor() {
    super("BROKER_CAPACITY_EXCEEDED");
    this.name = "BrokerCapacityError";
  }
}

export interface Broker {
  readonly type: "memory" | "redis";
  health(): Promise<void>;
  metrics(): BrokerMetrics;
  createChannel(rateLimitKey?: string, limit?: number): Promise<{ id: string; secret: string }>;
  hasChannel(id: string): Promise<boolean>;
  dispatch(
    channelId: string,
    request: Omit<PendingRequest, "id">,
    timeoutMs?: number,
  ): Promise<DownstreamResponse>;
  next(channelId: string, secret: string, waitMs?: number): Promise<PendingRequest | null>;
  respond(channelId: string, secret: string, requestId: string, response: DownstreamResponse): Promise<void>;
}
