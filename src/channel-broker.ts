import { randomUUID } from "node:crypto";

import type { Broker, DownstreamResponse, PendingRequest } from "./broker.js";

interface PendingExchange {
  request: PendingRequest;
  resolve: (response: DownstreamResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface Channel {
  id: string;
  queue: PendingExchange[];
  waiters: Array<(request: PendingRequest | null) => void>;
}

export class ChannelBroker implements Broker {
  private readonly channels = new Map<string, Channel>();

  async createChannel() {
    const id = randomUUID();
    this.channels.set(id, { id, queue: [], waiters: [] });
    return id;
  }

  async hasChannel(id: string) {
    return this.channels.has(id);
  }

  async dispatch(
    channelId: string,
    request: Omit<PendingRequest, "id">,
    timeoutMs = 30_000,
  ): Promise<DownstreamResponse> {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error("CHANNEL_NOT_FOUND");

    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const exchange: PendingExchange = {
        request: { id, ...request },
        resolve,
        reject,
        timeout: setTimeout(() => {
          channel.queue = channel.queue.filter((item) => item.request.id !== id);
          reject(new Error("DOWNSTREAM_TIMEOUT"));
        }, timeoutMs),
      };

      const waiter = channel.waiters.shift();
      if (waiter) waiter(exchange.request);
      channel.queue.push(exchange);
    });
  }

  async next(channelId: string, waitMs = 25_000): Promise<PendingRequest | null> {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error("CHANNEL_NOT_FOUND");

    const next = channel.queue.find((item) => !(item.request as PendingRequest & { delivered?: boolean }).delivered);
    if (next) {
      (next.request as PendingRequest & { delivered?: boolean }).delivered = true;
      return next.request;
    }

    return new Promise((resolve) => {
      const waiter = (request: PendingRequest | null) => {
        if (request) (request as PendingRequest & { delivered?: boolean }).delivered = true;
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

  async respond(channelId: string, requestId: string, response: DownstreamResponse) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error("CHANNEL_NOT_FOUND");

    const index = channel.queue.findIndex((item) => item.request.id === requestId);
    if (index < 0) throw new Error("REQUEST_NOT_FOUND");

    const [exchange] = channel.queue.splice(index, 1);
    clearTimeout(exchange.timeout);
    exchange.resolve(response);
  }
}
