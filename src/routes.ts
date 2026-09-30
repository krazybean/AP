import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";

import { BrokerUnavailableError, type Broker, type DownstreamResponse } from "./broker.js";
import { createBroker } from "./create-broker.js";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}

const CHANNEL_CREATION_LIMIT = Number.isInteger(Number(process.env.CHANNELS_PER_IP_PER_HOUR)) &&
  Number(process.env.CHANNELS_PER_IP_PER_HOUR) > 0
  ? Number(process.env.CHANNELS_PER_IP_PER_HOUR)
  : 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEALTH_CACHE_MS = 1_000;
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
  "trailer", "transfer-encoding", "upgrade",
]);
const FORWARDED = new Set(["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip"]);
const INBOUND_DENY = new Set([...HOP_BY_HOP, ...FORWARDED, "host", "content-length"]);

function filteredHeaders(headers: Record<string, string | string[] | undefined>, deny: Set<string>) {
  const blocked = new Set(deny);
  const connection = headers.connection;
  for (const value of Array.isArray(connection) ? connection : [connection]) {
    if (typeof value === "string") {
      for (const name of value.split(",")) blocked.add(name.trim().toLowerCase());
    }
  }
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) =>
    value !== undefined && !blocked.has(name.toLowerCase())) as [string, string | string[]][]);
}

function tokenMatches(header: string | string[] | undefined, token: string) {
  if (typeof header !== "string") return false;
  const supplied = header.match(/^Bearer (.+)$/)?.[1];
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

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
  let healthAt = 0;
  let healthOk: boolean | undefined;
  let healthCheck: Promise<boolean> | undefined;

  async function brokerHealthy() {
    if (healthOk !== undefined && Date.now() - healthAt < HEALTH_CACHE_MS) return healthOk;
    healthCheck ??= broker.health().then(() => true, (error) => {
      app.log.error(error, "AP health check failed");
      return false;
    });
    const result = await healthCheck;
    healthOk = result;
    healthAt = Date.now();
    healthCheck = undefined;
    return result;
  }

  function brokerUnavailable(error: unknown, reply: any) {
    if (!(error instanceof BrokerUnavailableError)) return false;
    metrics.brokerErrors += 1;
    if (error.retryAfterSeconds !== undefined) {
      reply.header("retry-after", String(error.retryAfterSeconds));
    }
    reply.code(503).send({ error: "broker_unavailable" });
    return true;
  }

  app.get("/health", async (_request, reply) => {
    if (await brokerHealthy()) {
      return {
        status: "ok",
        service: "ap",
        broker: "ok",
        brokerType: broker.type,
        ...broker.metrics(),
      };
    }
    metrics.brokerErrors += 1;
    return reply.code(503).send({
        status: "degraded",
        service: "ap",
        broker: "unavailable",
        brokerType: broker.type,
      });
  });

  app.get("/metrics", async (request, reply) => {
    const token = process.env.AP_METRICS_TOKEN;
    if (process.env.NODE_ENV === "production" && (!token || !tokenMatches(request.headers.authorization, token))) {
      return reply.code(404).send({ error: "not_found" });
    }
    return { brokerType: broker.type, ...metrics, ...broker.metrics() };
  });

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
      if (brokerUnavailable(error, reply)) return;
      metrics.brokerErrors += 1;
      throw error;
    }
  });

  app.get<{ Params: { channel: string } }>("/channels/:channel/next", async (request, reply) => {
    if (!UUID.test(request.params.channel)) return reply.code(404).send({ error: "channel_not_found" });
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
      if (brokerUnavailable(error, reply)) return;
      throw error;
    }
  });

  app.post<{
    Params: { channel: string; requestId: string };
    Body: unknown;
  }>("/channels/:channel/responses/:requestId", async (request, reply) => {
    if (!UUID.test(request.params.channel)) return reply.code(404).send({ error: "channel_not_found" });
    if (!UUID.test(request.params.requestId)) return reply.code(404).send({ error: "request_not_found" });
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
      if (brokerUnavailable(error, reply)) return;
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
    if (!UUID.test(channel)) return reply.code(404).send({ error: "channel_not_found" });
    try {
      metrics.proxyRequests += 1;
      const downstream = await broker.dispatch(channel, {
        method: request.method,
        path,
        headers: filteredHeaders(request.headers, INBOUND_DENY),
        body: request.body,
      });

      const safeHeaders = filteredHeaders(downstream.headers ?? {}, new Set([...HOP_BY_HOP, ...FORWARDED, "set-cookie"]));
      for (const [name, value] of Object.entries(safeHeaders)) {
        reply.header(name, value as string);
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
      if (brokerUnavailable(error, reply)) return;
      metrics.brokerErrors += 1;
      throw error;
    }
  }

  function bearerToken(authorization: string | string[] | undefined) {
    if (typeof authorization !== "string") return "";
    return authorization.match(/^Bearer (.+)$/)?.[1] ?? "";
  }
}
