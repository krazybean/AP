import Fastify from "fastify";

import { ChannelBroker } from "./channel-broker.js";

export function buildApp() {
  const app = Fastify({ logger: true });
  const broker = new ChannelBroker();

  app.get("/health", async () => ({
    status: "ok",
    service: "ap",
  }));

  app.post("/channels", async (_request, reply) => {
    const channel = broker.createChannel();
    return reply.code(201).send({
      channel,
      url: `/c/${channel}`,
    });
  });

  app.get<{ Params: { channel: string } }>("/channels/:channel/next", async (request, reply) => {
    try {
      const pending = await broker.next(request.params.channel);
      if (!pending) return reply.code(204).send();
      return pending;
    } catch {
      return reply.code(404).send({ error: "channel_not_found" });
    }
  });

  app.post<{
    Params: { channel: string; requestId: string };
    Body: { statusCode?: number; headers?: Record<string, string>; body?: unknown };
  }>("/channels/:channel/responses/:requestId", async (request, reply) => {
    try {
      broker.respond(request.params.channel, request.params.requestId, request.body ?? {});
      return reply.code(202).send({ accepted: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      return reply.code(404).send({
        error: message === "CHANNEL_NOT_FOUND" ? "channel_not_found" : "request_not_found",
      });
    }
  });

  app.all<{ Params: { channel: string; "*": string } }>("/c/:channel/*", async (request, reply) => {
    return proxyToChannel(request.params.channel, `/${request.params["*"]}`, request, reply);
  });

  app.all<{ Params: { channel: string } }>("/c/:channel", async (request, reply) => {
    return proxyToChannel(request.params.channel, "/", request, reply);
  });

  async function proxyToChannel(
    channel: string,
    path: string,
    request: { method: string; headers: Record<string, string | string[] | undefined>; body?: unknown },
    reply: { code: (statusCode: number) => any; header: (name: string, value: string) => any; send: (payload?: unknown) => any },
  ) {
    if (!broker.hasChannel(channel)) {
      return reply.code(404).send({ error: "channel_not_found" });
    }

    try {
      const downstream = await broker.dispatch(channel, {
        method: request.method,
        path,
        headers: request.headers,
        body: request.body,
      });

      for (const [name, value] of Object.entries(downstream.headers ?? {})) {
        reply.header(name, value);
      }

      return reply.code(downstream.statusCode ?? 200).send(downstream.body);
    } catch {
      return reply.code(504).send({ error: "downstream_timeout" });
    }
  }

  return app;
}
