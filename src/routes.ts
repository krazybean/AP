import type { FastifyInstance } from "fastify";

import type { Broker, DownstreamResponse } from "./broker.js";
import { createBroker } from "./create-broker.js";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}

const CHANNEL_CREATION_LIMIT = Number.isInteger(Number(process.env.CHANNELS_PER_IP_PER_HOUR)) &&
  Number(process.env.CHANNELS_PER_IP_PER_HOUR) > 0
  ? Number(process.env.CHANNELS_PER_IP_PER_HOUR)
  : 10;

function parseDownstreamResponse(body: unknown): DownstreamResponse | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  const candidate = body as Record<string, unknown>;
  const statusCode = candidate.statusCode;
  if (statusCode !== undefined &&
      (typeof statusCode !== "number" || !Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599)) {
    return null;
  }

  if (candidate.headers !== undefined &&
      (typeof candidate.headers !== "object" || candidate.headers === null || Array.isArray(candidate.headers) ||
        Object.values(candidate.headers).some((value) => typeof value !== "string"))) {
    return null;
  }

  return {
    statusCode: statusCode as number | undefined,
    headers: candidate.headers as Record<string, string> | undefined,
    body: candidate.body,
  };
}

export function registerRoutes(app: FastifyInstance, broker: Broker = createBroker()) {
  const metrics = {
    channelsCreated: 0,
    channelRateLimits: 0,
    proxyRequests: 0,
    proxyResponses: 0,
    proxyTimeouts: 0,
    brokerErrors: 0,
  };

  app.get("/health", async (_request, reply) => {
    try {
      await broker.health();
      return { status: "ok", service: "ap", broker: "ok", ...broker.metrics() };
    } catch (error) {
      metrics.brokerErrors += 1;
      app.log.error(error, "AP health check failed");
      return reply.code(503).send({ status: "degraded", service: "ap", broker: "unavailable" });
    }
  });

  app.get("/metrics", async () => ({ ...metrics, ...broker.metrics() }));

  app.post("/channels", async (request, reply) => {
    const license = request.headers["x-app-license"];
    if (process.env.REQUIRE_LICENSE === "true" &&
        (typeof license !== "string" || license.trim() === "")) {
      return reply.code(401).send({ error: "application_license_required" });
    }

    try {
      const { id: channel, secret } = await broker.createChannel(request.ip, CHANNEL_CREATION_LIMIT);
      metrics.channelsCreated += 1;
      return reply.code(201).send({
        channel,
        secret,
        url: `/c/${channel}`,
      });
    } catch (error) {
      if (errorMessage(error) === "CHANNEL_RATE_LIMITED") {
        metrics.channelRateLimits += 1;
        return reply.header("retry-after", "3600").code(429).send({ error: "channel_rate_limited" });
      }
      metrics.brokerErrors += 1;
      throw error;
    }
  });

  app.get<{ Params: { channel: string } }>("/channels/:channel/next", async (request, reply) => {
    if (!(await broker.hasChannel(request.params.channel))) {
      return reply.code(404).send({ error: "channel_not_found" });
    }

    try {
      const pending = await broker.next(request.params.channel, bearerToken(request.headers.authorization));
      if (!pending) return reply.code(204).send();
      return pending;
    } catch (error) {
      if (errorMessage(error) === "CHANNEL_NOT_FOUND") {
        return reply.code(404).send({ error: "channel_not_found" });
      }
      if (errorMessage(error) === "CHANNEL_UNAUTHORIZED") {
        return reply.code(401).send({ error: "channel_unauthorized" });
      }
      throw error;
    }
  });

  app.post<{
    Params: { channel: string; requestId: string };
    Body: unknown;
  }>("/channels/:channel/responses/:requestId", async (request, reply) => {
    if (!(await broker.hasChannel(request.params.channel))) {
      return reply.code(404).send({ error: "channel_not_found" });
    }

    const response = parseDownstreamResponse(request.body);
    if (!response) return reply.code(400).send({ error: "invalid_response" });

    try {
      await broker.respond(
        request.params.channel,
        bearerToken(request.headers.authorization),
        request.params.requestId,
        response,
      );
      return reply.code(202).send({ accepted: true });
    } catch (error) {
      const message = errorMessage(error);
      if (message === "CHANNEL_NOT_FOUND") {
        return reply.code(404).send({ error: "channel_not_found" });
      }
      if (message === "REQUEST_NOT_FOUND") {
        return reply.code(404).send({ error: "request_not_found" });
      }
      if (message === "CHANNEL_UNAUTHORIZED") {
        return reply.code(401).send({ error: "channel_unauthorized" });
      }
      throw error;
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
    if (!(await broker.hasChannel(channel))) {
      return reply.code(404).send({ error: "channel_not_found" });
    }

    try {
      metrics.proxyRequests += 1;
      const downstream = await broker.dispatch(channel, {
        method: request.method,
        path,
        headers: request.headers,
        body: request.body,
      });

      for (const [name, value] of Object.entries(downstream.headers ?? {})) {
        reply.header(name, value);
      }

      metrics.proxyResponses += 1;
      return reply.code(downstream.statusCode ?? 200).send(downstream.body);
    } catch (error) {
      const message = errorMessage(error);
      if (message === "CHANNEL_NOT_FOUND") {
        return reply.code(404).send({ error: "channel_not_found" });
      }
      if (message === "DOWNSTREAM_TIMEOUT") {
        metrics.proxyTimeouts += 1;
        return reply.code(504).send({ error: "downstream_timeout" });
      }
      metrics.brokerErrors += 1;
      throw error;
    }
  }

  function bearerToken(authorization: string | string[] | undefined) {
    if (typeof authorization !== "string") throw new Error("CHANNEL_UNAUTHORIZED");
    const match = authorization.match(/^Bearer (.+)$/);
    if (!match) throw new Error("CHANNEL_UNAUTHORIZED");
    return match[1];
  }
}
