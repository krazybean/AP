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

export interface Broker {
  createChannel(): Promise<string>;
  hasChannel(id: string): Promise<boolean>;
  dispatch(
    channelId: string,
    request: Omit<PendingRequest, "id">,
    timeoutMs?: number,
  ): Promise<DownstreamResponse>;
  next(channelId: string, waitMs?: number): Promise<PendingRequest | null>;
  respond(channelId: string, requestId: string, response: DownstreamResponse): Promise<void>;
}
