import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { validateHeaderName, validateHeaderValue } from "node:http";
import { isIP } from "node:net";
import { gunzipSync } from "node:zlib";

import { registerAccountRoutes } from "./account-routes.js";
import { BrokerCapacityError, BrokerUnavailableError, ChannelRateLimitError, type AccessConfig, type Broker, type DownstreamResponse, type ExposureConfig } from "./broker.js";
import { createBroker } from "./create-broker.js";
import type { GitHubDeviceClient } from "./github.js";
import type { GoogleDeviceClient } from "./google.js";
import { defaultExposureMode } from "./http-config.js";
import { canonicalApplicationPath, canonicalDispatchPath, scopeAllows, validateScopes } from "./client-scopes.js";
import { buildChannelUrl, classifyChannelHost, classifyChannelHostFailure, normalizeBaseDomain } from "./origin-routing.js";
import { HERO_POSTER, HERO_POSTER_PATH, HERO_VIDEO, HERO_VIDEO_PATH } from "./hero-media.js";
import { DEMO_FILES, DEMO_HTML } from "./demo-assets.js";
import { CONSENT_SCRIPT, CONSENT_SCRIPT_PATH, GA_ID, LANDING_PAGES, PRIVACY_PAGE, PRIVACY_PAGE_ANALYTICS, withAnalytics, type HeroVariant } from "./site.js";
import { createAuditEmitter, loggerAuditSink, SecurityMetrics, type AuditSink, type SecurityAuditEvent } from "./security-telemetry.js";
import { validateServiceName } from "./services.js";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}

export function sourceRateLimitKey(ip: string | undefined) {
  const value = ip?.trim().toLowerCase() || "unknown";
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped && isIP(mapped) === 4 ? mapped : value;
}

const CHANNEL_CREATION_LIMIT = Number.isInteger(Number(process.env.CHANNELS_PER_IP_PER_HOUR)) &&
  Number(process.env.CHANNELS_PER_IP_PER_HOUR) > 0
  ? Number(process.env.CHANNELS_PER_IP_PER_HOUR)
  : 10;
const SERVICE_CREATION_LIMIT = Number.isInteger(Number(process.env.SERVICES_PER_IP_PER_HOUR)) &&
  Number(process.env.SERVICES_PER_IP_PER_HOUR) > 0
  ? Number(process.env.SERVICES_PER_IP_PER_HOUR)
  : 10;
// Signed-in callers are bounded by their live-channel limit; this only stops runaway create loops.
const ACCOUNT_CHANNELS_PER_HOUR = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEALTH_CACHE_MS = 1_000;
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
  "trailer", "transfer-encoding", "upgrade",
]);
const FORWARDED = new Set(["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip"]);
const INBOUND_DENY = new Set([...HOP_BY_HOP, ...FORWARDED, "host", "content-length", "x-ap-access-token", "x-ap-downstream-secret", "x-ap-service-secret", "x-ap-key"]);
// AP re-serializes response bodies, so the downstream's encoding and length headers never describe what AP sends.
const OUTBOUND_DENY = new Set([...HOP_BY_HOP, ...FORWARDED, "set-cookie", "x-ap-request-id", "content-encoding", "content-length"]);
// Path channels all share AP's origin, so their pages run in an opaque-origin sandbox:
// scripts still run, but cannot read other channels, AP storage or register service workers.
const SHARED_ORIGIN_DENY = new Set([...OUTBOUND_DENY, "service-worker-allowed"]);
const SHARED_ORIGIN_SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-downloads";

function validHeader(name: string, value: string) {
  try {
    validateHeaderName(name);
    validateHeaderValue(name, value);
    return true;
  } catch {
    return false;
  }
}

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
      (typeof statusCode !== "number" || !Number.isInteger(statusCode) || statusCode < 200 || statusCode > 599)) {
    return null;
  }

  if (candidate.headers !== undefined &&
      (typeof candidate.headers !== "object" || candidate.headers === null || Array.isArray(candidate.headers) ||
        Object.entries(candidate.headers).some(([name, value]) => typeof value !== "string" || !validHeader(name, value)))) {
    return null;
  }

  return {
    statusCode: statusCode as number | undefined,
    headers: candidate.headers as Record<string, string> | undefined,
    body: candidate.body,
  };
}

function parseAccess(body: unknown): AccessConfig | null {
  if (body === undefined || body === null) return { mode: "public" };
  if (typeof body !== "object" || Array.isArray(body)) return null;
  const access = (body as Record<string, unknown>).access;
  if (access === undefined) return { mode: "public" };
  if (!access || typeof access !== "object" || Array.isArray(access)) return null;
  const mode = (access as Record<string, unknown>).mode;
  if (mode !== "public" && mode !== "bearer") return null;
  try {
    const scopes = validateScopes((access as Record<string, unknown>).scopes);
    if (mode === "public" && scopes) return null;
    return { mode, ...(scopes ? { scopes } : {}) };
  } catch {
    return null;
  }
}

function parseExposure(body: unknown): ExposureConfig | null {
  if (body === undefined || body === null) return { mode: defaultExposureMode() };
  if (typeof body !== "object" || Array.isArray(body)) return null;
  const exposure = (body as Record<string, unknown>).exposure;
  if (exposure === undefined) return { mode: defaultExposureMode() };
  if (!exposure || typeof exposure !== "object" || Array.isArray(exposure)) return null;
  const mode = (exposure as Record<string, unknown>).mode;
  return mode === "path" || mode === "isolated-host" ? { mode } : null;
}

export interface RouteOptions {
  auditSink?: AuditSink;
  github?: GitHubDeviceClient;
  google?: GoogleDeviceClient;
}

export function registerRoutes(app: FastifyInstance, broker: Broker = createBroker(), options: RouteOptions = {}) {
  defaultExposureMode();
  const securityMetrics = new SecurityMetrics();
  const emitAudit = createAuditEmitter(options.auditSink ?? loggerAuditSink(app.log), () => securityMetrics.recordAuditFailure());
  const audit = (request: { id: string }, event: { event: SecurityAuditEvent["event"]; [key: string]: unknown }) => {
    emitAudit({ ...event, timestamp: new Date().toISOString(), requestId: request.id } as SecurityAuditEvent);
  };
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-ap-request-id", request.id);
  });
  const metrics = {
    channelsCreated: 0,
    channelRateLimits: 0,
    proxyRequests: 0,
    proxyResponses: 0,
    proxyTimeouts: 0,
    brokerErrors: 0,
    clientAuthSuccesses: 0,
    clientAuthFailures: 0,
    authorizationAllowed: 0,
    authorizationDenied: 0,
    invalidScopeConfigurations: 0,
    clientCredentialsCreated: 0,
    clientCredentialsRevoked: 0,
  };
  const accounts = registerAccountRoutes(app, {
    broker,
    github: options.github,
    google: options.google,
    audit,
    securityMetrics,
    brokerUnavailable,
    sourceKey: sourceRateLimitKey,
    adminAuthorized: (authorization) => {
      const token = process.env.AP_ADMIN_TOKEN;
      return Boolean(token) && tokenMatches(authorization, token!);
    },
  });
  let healthAt = 0;
  let healthOk: boolean | undefined;
  let healthCheck: Promise<boolean> | undefined;

  function requestId(request: { id: string }) {
    return request.id;
  }

  function hostClassification(request: { headers: Record<string, string | string[] | undefined> }) {
    const configured = process.env.AP_CHANNEL_BASE_DOMAIN;
    if (!configured) return null;
    try {
      const host = typeof request.headers.host === "string" ? request.headers.host : "";
      return classifyChannelHost(host, configured) ?? classifyChannelHostFailure(host, configured);
    } catch {
      return "invalid" as const;
    }
  }

  async function brokerHealthy() {
    if (healthOk !== undefined && Date.now() - healthAt < HEALTH_CACHE_MS) return healthOk;
    healthCheck ??= broker.health().then(() => true, (error) => {
      app.log.error({ event: "broker.health_failed" }, "AP health check failed");
      return false;
    });
    const result = await healthCheck;
    healthOk = result;
    healthAt = Date.now();
    healthCheck = undefined;
    return result;
  }

  function brokerUnavailable(error: unknown, reply: any, request?: { id: string }) {
    if (!(error instanceof BrokerUnavailableError)) return false;
    metrics.brokerErrors += 1;
    securityMetrics.recordBrokerError("unavailable");
    if (request) audit(request, { event: "broker.unavailable", reason: "unavailable" });
    if (error.retryAfterSeconds !== undefined) {
      reply.header("retry-after", String(error.retryAfterSeconds));
    }
    reply.code(503).send({ error: "broker_unavailable" });
    return true;
  }

  // AP's own pages. On isolated channel hosts the preHandler hook has already proxied the request.
  const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  // The landing page shows AP's own media (the still frame as a background image, the video) and the demo (an <object>).
  const LANDING_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self'; media-src 'self'; object-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  // The demo is a separate page with the only script AP serves. `blob:` is for the text renderer's worker, which it builds from its own code. It is the one page that may be framed, and only by AP itself.
  const DEMO_CSP = "default-src 'none'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self'; connect-src 'self' data: blob:; worker-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
  const sitePage = (html: (request: any) => string, csp = PAGE_CSP) => async (request: any, reply: any) => reply
    .header("content-type", "text/html; charset=utf-8")
    .header("content-security-policy", csp)
    .header("x-content-type-options", "nosniff")
    .header("cache-control", "public, max-age=300")
    .send(html(request));
  // Backouts for the hero, with no redeploy of code: ?hero=video and ?hero=static show those versions on demand, and the
  // AP_HERO environment variable ("live" by default, or "video" or "static") picks what everyone gets.
  const isVariant = (value: unknown): value is HeroVariant => value === "live" || value === "video" || value === "static";
  const heroVariant = (request: any): HeroVariant => {
    if (isVariant(request.query?.hero)) return request.query.hero;
    const configured = (process.env.AP_HERO ?? "").trim().toLowerCase();
    return isVariant(configured) ? configured : "live";
  };
  // Opt-in analytics on AP's own website pages only, when AP_GA_ID is a GA4 measurement id. Off, the pages and CSPs are unchanged.
  const analyticsId = () => { const id = (process.env.AP_GA_ID ?? "").trim(); return GA_ID.test(id) ? id : ""; };
  const GA_CSP = (csp: string) => csp
    .replace("img-src data:", "img-src data: https://*.google-analytics.com https://*.googletagmanager.com")
    .replace("; base-uri", "; script-src 'self' https://www.googletagmanager.com; connect-src https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com; base-uri");
  const analyticsPage = (html: (request: any) => string, csp: string) => async (request: any, reply: any) => {
    const id = analyticsId();
    return sitePage((r) => id ? withAnalytics(html(r), id) : html(r), id ? GA_CSP(csp) : csp)(request, reply);
  };
  app.get("/", analyticsPage((request) => LANDING_PAGES[heroVariant(request)], LANDING_CSP));
  app.get("/privacy", analyticsPage(() => analyticsId() ? PRIVACY_PAGE_ANALYTICS : PRIVACY_PAGE, PAGE_CSP));
  app.get(CONSENT_SCRIPT_PATH, async (_request, reply) => analyticsId()
    ? reply.header("content-type", "application/javascript; charset=utf-8").header("x-content-type-options", "nosniff").header("cache-control", "public, max-age=300").send(CONSENT_SCRIPT)
    : reply.code(404).send({ error: "not_found" }));

  // The interactive demo: the same bundle serves the full-screen page and the landing hero. It reads the hero media paths from <meta> tags.
  const demoHtml = DEMO_HTML.replace("</head>", `<meta name="ap-hero-video" content="${HERO_VIDEO_PATH}"><meta name="ap-hero-poster" content="${HERO_POSTER_PATH}"></head>`);
  app.get("/demo", sitePage(() => demoHtml, DEMO_CSP));
  const plain = new Map<string, Buffer>();
  app.get<{ Params: { file: string } }>("/demo-assets/:file", async (request, reply) => {
    const path = `/demo-assets/${request.params.file}`;
    const asset = Object.hasOwn(DEMO_FILES, path) ? DEMO_FILES[path] : undefined;
    if (!asset) return reply.code(404).send({ error: "not_found" });
    reply
      .header("content-type", asset.type)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("vary", "accept-encoding");
    if (/\bgzip\b/i.test(String(request.headers["accept-encoding"] ?? ""))) return reply.header("content-encoding", "gzip").send(asset.gzip);
    if (!plain.has(path)) plain.set(path, gunzipSync(asset.gzip));
    return reply.send(plain.get(path));
  });

  // The hero media is embedded in the build (src/hero-media.ts). Names carry a content hash, so they cache forever.
  // Range requests are supported because Safari will not play a video without them.
  const heroMedia = (path: string, type: string, body: Buffer) => app.get(path, async (request, reply) => {
    reply
      .header("content-type", type)
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("accept-ranges", "bytes");
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? "").trim());
    if (!range || (range[1] === "" && range[2] === "")) return reply.send(body);
    const size = body.length;
    const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
    const end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
    if (start >= size || start > end) return reply.code(416).header("content-range", `bytes */${size}`).send();
    return reply.code(206).header("content-range", `bytes ${start}-${end}/${size}`).send(body.subarray(start, end + 1));
  });
  heroMedia(HERO_VIDEO_PATH, "video/mp4", HERO_VIDEO);
  heroMedia(HERO_POSTER_PATH, "image/jpeg", HERO_POSTER);

  app.get("/health", async (request, reply) => {
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
    securityMetrics.recordBrokerError("operation");
    audit(request, { event: "broker.error", reason: "operation" });
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
    return { brokerType: broker.type, ...metrics, security: securityMetrics.snapshot(), ...broker.metrics() };
  });

  app.post<{ Body: { name?: unknown } }>("/services", async (request, reply) => {
    const name = request.body?.name;
    try {
      validateServiceName(name);
    } catch {
      return reply.code(400).send({ error: "invalid_service_name" });
    }
    try {
      const account = await accounts.caller(request, reply);
      if (account === false) return;
      const created = await broker.createService(name as string, sourceRateLimitKey(request.ip), SERVICE_CREATION_LIMIT);
      if (account) await broker.accounts.recordService(account.githubId, created.name);
      securityMetrics.recordServiceCreated();
      audit(request, { event: "service.created", serviceId: created.serviceId, name: created.name });
      return reply.code(201).send(created);
    } catch (error) {
      const message = errorMessage(error);
      if (message === "SERVICE_NAME_TAKEN") return reply.code(409).send({ error: "service_name_taken" });
      if (message === "SERVICE_RATE_LIMITED") return reply.header("retry-after", "3600").code(429).send({ error: "service_rate_limited" });
      if (message === "INVALID_SERVICE_NAME") return reply.code(400).send({ error: "invalid_service_name" });
      if (brokerUnavailable(error, reply, request)) return;
      throw error;
    }
  });

  app.get<{ Params: { name: string } }>("/services/:name", async (request, reply) => {
    try {
      validateServiceName(request.params.name);
    } catch {
      return reply.code(404).send({ error: "service_not_found" });
    }
    try {
      const snapshot = await broker.getService(request.params.name);
      if (!snapshot) return reply.code(404).send({ error: "service_not_found" });
      let baseDomain: string | undefined;
      if (snapshot.instances.some((instance) => instance.exposureMode === "isolated-host")) {
        try { baseDomain = normalizeBaseDomain(process.env.AP_CHANNEL_BASE_DOMAIN ?? ""); }
        catch { return reply.code(503).send({ error: "isolated_host_not_configured" }); }
      }
      return {
        ...snapshot.service,
        instances: snapshot.instances.map((instance) => ({
          channel: instance.channel,
          url: instance.exposureMode === "isolated-host" ? buildChannelUrl(instance.channel, baseDomain!) : `/c/${instance.channel}`,
          access: instance.accessMode,
          exposure: instance.exposureMode,
        })),
      };
    } catch (error) {
      if (brokerUnavailable(error, reply, request)) return;
      throw error;
    }
  });

  app.put<{ Params: { name: string; channel: string } }>("/services/:name/instances/:channel", async (request, reply) => {
    return bindServiceInstance(request, reply, false);
  });

  app.delete<{ Params: { name: string; channel: string } }>("/services/:name/instances/:channel", async (request, reply) => {
    return bindServiceInstance(request, reply, true);
  });

  async function bindServiceInstance(request: { id: string; params: { name: string; channel: string }; headers: Record<string, string | string[] | undefined> }, reply: any, unbind: boolean) {
    try { validateServiceName(request.params.name); }
    catch { return reply.code(404).send({ error: "service_not_found" }); }
    const serviceSecret = typeof request.headers["x-ap-service-secret"] === "string" ? request.headers["x-ap-service-secret"] : "";
    const channelSecret = typeof request.headers["x-ap-downstream-secret"] === "string" ? request.headers["x-ap-downstream-secret"] : "";
    try {
      const account = await accounts.caller(request, reply);
      if (account === false) return;
      if (!(await accounts.serviceAllowed(request, reply, account, request.params.name))) return;
      if (UUID.test(request.params.channel) && !(await accounts.channelAllowed(request, reply, account, request.params.channel))) return;
      const serviceId = unbind
        ? await broker.unbindServiceInstance(request.params.name, serviceSecret, request.params.channel, channelSecret)
        : await broker.bindServiceInstance(request.params.name, serviceSecret, request.params.channel, channelSecret);
      if (unbind) {
        securityMetrics.recordServiceUnbound();
        audit(request, { event: "service.instance_unbound", serviceId, channel: request.params.channel });
      } else {
        securityMetrics.recordServiceBound();
        audit(request, { event: "service.instance_bound", serviceId, channel: request.params.channel });
      }
      return reply.code(204).send();
    } catch (error) {
      const message = errorMessage(error);
      if (message === "SERVICE_NOT_FOUND" || message === "CHANNEL_NOT_FOUND") return reply.code(404).send({ error: message === "SERVICE_NOT_FOUND" ? "service_not_found" : "channel_not_found" });
      if (message === "SERVICE_UNAUTHORIZED" || message === "CHANNEL_UNAUTHORIZED") {
        securityMetrics.recordServiceAuthFailure();
        const rejected = message === "SERVICE_UNAUTHORIZED" ? serviceSecret : channelSecret;
        audit(request, { event: "service.auth_rejected", reason: rejected ? "invalid" : "missing" });
        return reply.code(401).send({ error: message === "SERVICE_UNAUTHORIZED" ? "service_unauthorized" : "channel_unauthorized" });
      }
      if (message === "SERVICE_CHANNEL_CONFLICT") return reply.code(409).send({ error: "service_channel_conflict" });
      if (message === "SERVICE_INSTANCE_LIMIT") return reply.header("retry-after", "1").code(429).send({ error: "service_instance_limit" });
      if (brokerUnavailable(error, reply, request)) return;
      throw error;
    }
  }

  app.post("/channels", async (request, reply) => {
    const license = request.headers["x-app-license"];
    if (process.env.REQUIRE_LICENSE === "true" &&
        (typeof license !== "string" || license.trim() === "")) {
      return reply.code(401).send({ error: "application_license_required" });
    }

    const access = parseAccess(request.body);
    if (!access) {
      metrics.invalidScopeConfigurations += 1;
      return reply.code(400).send({ error: "invalid_access_configuration" });
    }
    const exposure = parseExposure(request.body);
    if (!exposure) return reply.code(400).send({ error: "invalid_exposure_configuration" });
    let baseDomain: string | undefined;
    if (exposure.mode === "isolated-host") {
      try {
        baseDomain = normalizeBaseDomain(process.env.AP_CHANNEL_BASE_DOMAIN ?? "");
      } catch {
        return reply.code(503).send({ error: "isolated_host_not_configured" });
      }
    }

    try {
      const account = await accounts.caller(request, reply);
      if (account === false) return;
      if (!(await accounts.channelSlotAvailable(request, reply, account))) return;
      const created = account
        ? await broker.createChannel(`account:${account.githubId}`, ACCOUNT_CHANNELS_PER_HOUR, access, exposure)
        : await broker.createChannel(sourceRateLimitKey(request.ip), CHANNEL_CREATION_LIMIT, access, exposure);
      const { id: channel, secret, accessMode, clientCredential } = created;
      if (account) await broker.accounts.recordChannel(account.githubId, channel);
      const exposureMode = created.exposureMode ?? exposure.mode;
      metrics.channelsCreated += 1;
      securityMetrics.recordChannelCreated(accessMode, exposureMode);
      audit(request, { event: "channel.created", channel, access: accessMode, exposure: exposureMode });
      if (clientCredential) securityMetrics.recordCredentialCreated();
      if (clientCredential) audit(request, { event: "credential.created", channel, credentialId: clientCredential.id });
      return reply.code(201).send({
        channel,
        secret,
        url: exposureMode === "isolated-host" ? buildChannelUrl(channel, baseDomain!) : `/c/${channel}`,
        ...(exposureMode === "isolated-host" ? { exposure: { mode: exposureMode } } : {}),
        access: {
          mode: accessMode,
          ...(clientCredential?.scopes ? { scopes: clientCredential.scopes } : {}),
          ...(clientCredential ? { credentialId: clientCredential.id, token: clientCredential.token } : {}),
        },
      });
    } catch (error) {
      if (error instanceof ChannelRateLimitError || errorMessage(error) === "CHANNEL_RATE_LIMITED") {
        metrics.channelRateLimits += 1;
        return reply.header("retry-after", String(error instanceof ChannelRateLimitError ? error.retryAfterSeconds : 3600)).code(429).send({ error: "channel_rate_limited" });
      }
      if (brokerUnavailable(error, reply, request)) return;
      metrics.brokerErrors += 1;
      securityMetrics.recordBrokerError("operation");
      audit(request, { event: "broker.error", reason: "operation" });
      throw error;
    }
  });

  app.post<{ Params: { channel: string }; Body: { expiresAt?: unknown; scopes?: unknown } }>("/channels/:channel/access-tokens", async (request, reply) => {
    if (!UUID.test(request.params.channel)) return reply.code(404).send({ error: "channel_not_found" });
    const rawExpiry = request.body?.expiresAt;
    const expiresAt = rawExpiry === undefined ? undefined : typeof rawExpiry === "string" ? Date.parse(rawExpiry) : NaN;
    if (Number.isNaN(expiresAt)) return reply.code(400).send({ error: "invalid_expiration" });
    let scopes;
    try {
      scopes = validateScopes(request.body?.scopes);
    } catch {
      metrics.invalidScopeConfigurations += 1;
      return reply.code(400).send({ error: "invalid_scopes" });
    }
    try {
      const account = await accounts.caller(request, reply);
      if (account === false || !(await accounts.channelAllowed(request, reply, account, request.params.channel))) return;
      const credential = await broker.createClientCredential(request.params.channel, downstreamSecret(request.headers), expiresAt, scopes);
      metrics.clientCredentialsCreated += 1;
      securityMetrics.recordCredentialCreated();
      audit(request, { event: "credential.created", channel: request.params.channel, credentialId: credential.id });
      return reply.code(201).send({ credentialId: credential.id, token: credential.token, createdAt: credential.createdAt, ...(credential.expiresAt === undefined ? {} : { expiresAt: new Date(credential.expiresAt).toISOString() }), ...(credential.scopes ? { scopes: credential.scopes } : {}) });
    } catch (error) {
      const message = errorMessage(error);
      if (message === "CHANNEL_NOT_FOUND") return reply.code(404).send({ error: "channel_not_found" });
      if (message === "CHANNEL_UNAUTHORIZED") {
        audit(request, { event: "auth.downstream.rejected", channel: request.params.channel, reason: "invalid_secret" });
        return reply.code(401).send({ error: "channel_unauthorized" });
      }
      if (message === "CLIENT_CREDENTIAL_LIMIT") return reply.code(429).send({ error: "client_credential_limit" });
      if (message === "CLIENT_ACCESS_NOT_ENABLED") return reply.code(400).send({ error: "client_access_not_enabled" });
      if (message === "CLIENT_CREDENTIAL_EXPIRY_INVALID") return reply.code(400).send({ error: "invalid_expiration" });
      if (brokerUnavailable(error, reply, request)) return;
      metrics.brokerErrors += 1;
      securityMetrics.recordBrokerError("operation");
      audit(request, { event: "broker.error", reason: "operation" });
      throw error;
    }
  });

  app.delete<{ Params: { channel: string; credentialId: string } }>("/channels/:channel/access-tokens/:credentialId", async (request, reply) => {
    if (!UUID.test(request.params.channel)) return reply.code(404).send({ error: "channel_not_found" });
    try {
      const account = await accounts.caller(request, reply);
      if (account === false || !(await accounts.channelAllowed(request, reply, account, request.params.channel))) return;
      await broker.revokeClientCredential(request.params.channel, downstreamSecret(request.headers), request.params.credentialId);
      metrics.clientCredentialsRevoked += 1;
      securityMetrics.recordCredentialRevoked();
      audit(request, { event: "credential.revoked", channel: request.params.channel, credentialId: request.params.credentialId });
      return reply.code(204).send();
    } catch (error) {
      const message = errorMessage(error);
      if (message === "CHANNEL_NOT_FOUND" || message === "CLIENT_CREDENTIAL_NOT_FOUND") return reply.code(404).send({ error: message === "CHANNEL_NOT_FOUND" ? "channel_not_found" : "credential_not_found" });
      if (message === "CHANNEL_UNAUTHORIZED") {
        audit(request, { event: "auth.downstream.rejected", channel: request.params.channel, reason: "invalid_secret" });
        return reply.code(401).send({ error: "channel_unauthorized" });
      }
      if (brokerUnavailable(error, reply, request)) return;
      metrics.brokerErrors += 1;
      securityMetrics.recordBrokerError("operation");
      audit(request, { event: "broker.error", reason: "operation" });
      throw error;
    }
  });

  app.get<{ Params: { channel: string } }>("/channels/:channel/next", async (request, reply) => {
    if (!UUID.test(request.params.channel)) return reply.code(404).send({ error: "channel_not_found" });
    try {
      const account = await accounts.caller(request, reply);
      if (account === false || !(await accounts.channelAllowed(request, reply, account, request.params.channel))) return;
      const pending = await broker.next(request.params.channel, bearerToken(request.headers.authorization));
      if (!pending) return reply.code(204).send();
      return pending;
    } catch (error) {
      if (errorMessage(error) === "CHANNEL_NOT_FOUND") {
        return reply.code(404).send({ error: "channel_not_found" });
      }
      if (errorMessage(error) === "CHANNEL_UNAUTHORIZED") {
        audit(request, { event: "auth.downstream.rejected", channel: request.params.channel, reason: "invalid_secret" });
        return reply.code(401).send({ error: "channel_unauthorized" });
      }
      if (brokerUnavailable(error, reply, request)) return;
      metrics.brokerErrors += 1;
      securityMetrics.recordBrokerError("operation");
      audit(request, { event: "broker.error", reason: "operation" });
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
      const account = await accounts.caller(request, reply);
      if (account === false || !(await accounts.channelAllowed(request, reply, account, request.params.channel))) return;
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
        audit(request, { event: "auth.downstream.rejected", channel: request.params.channel, reason: "invalid_secret" });
        return reply.code(401).send({ error: "channel_unauthorized" });
      }
      if (brokerUnavailable(error, reply, request)) return;
      metrics.brokerErrors += 1;
      securityMetrics.recordBrokerError("operation");
      audit(request, { event: "broker.error", reason: "operation" });
      throw error;
    }
  });

  app.all<{ Params: { channel: string; "*": string } }>("/c/:channel/*", async (request, reply) => {
    return proxyToChannel(request.params.channel, requestPath(request.url, request.params.channel, `/${request.params["*"]}`), request, reply);
  });

  app.all<{ Params: { channel: string } }>("/c/:channel", async (request, reply) => {
    return proxyToChannel(request.params.channel, requestPath(request.url, request.params.channel, "/"), request, reply);
  });

  async function isolatedHostProxy(request: { id: string; url: string; headers: Record<string, string | string[] | undefined>; method: string; body?: unknown }, reply: any) {
    const classification = hostClassification(request);
    if (classification === "invalid" || classification === "malformed" || classification === "invalid_channel" || classification === "invalid_suffix") {
      const reason = classification === "invalid" ? "malformed" : classification;
      securityMetrics.recordInvalidHost(reason);
      audit(request, { event: "origin.invalid_host", reason });
      return reply.code(404).send({ error: "not_found" });
    }
    if (!classification) return reply.code(404).send({ error: "not_found" });
    const channel = classification;
    let exposure;
    try {
      exposure = await broker.channelExposure(channel);
    } catch (error) {
      if (brokerUnavailable(error, reply, request)) return;
      throw error;
    }
    if (exposure !== "isolated-host") {
      securityMetrics.recordInvalidHost("invalid_channel");
      audit(request, { event: "origin.invalid_host", reason: "invalid_channel" });
      return reply.code(404).send({ error: "not_found" });
    }
    return proxyToChannel(channel, request.url || "/", request, reply, true);
  }

  app.addHook("preHandler", async (request, reply) => {
    const classification = hostClassification(request);
    if (classification) {
      return isolatedHostProxy(request, reply);
    }
  });
  app.setNotFoundHandler((request, reply) => {
    if (hostClassification(request)) return isolatedHostProxy(request, reply);
    return reply.code(404).send({ error: "not_found" });
  });

  async function proxyToChannel(
    channel: string,
    path: string,
    request: { id: string; method: string; headers: Record<string, string | string[] | undefined>; body?: unknown },
    reply: { code: (statusCode: number) => any; header: (name: string, value: string) => any; send: (payload?: unknown) => any },
    isolatedHost = false,
  ) {
    if (!UUID.test(channel)) return reply.code(404).send({ error: "channel_not_found" });
    try {
      if (!isolatedHost && await broker.channelExposure(channel) === "isolated-host") {
        securityMetrics.recordLegacyPathBlock();
        audit(request, { event: "origin.legacy_path_blocked", channel });
        return reply.code(404).send({ error: "channel_not_found" });
      }
      let dispatchPath = path;
      const accessToken = clientAccessToken(request.headers);
      try {
        const authenticated = await broker.authenticateClient(channel, accessToken);
        if (authenticated) metrics.clientAuthSuccesses += 1;
        if (authenticated?.scopes) {
          let applicationPath: string;
          try {
            applicationPath = canonicalApplicationPath(path);
          } catch {
            metrics.authorizationDenied += 1;
            return reply.code(400).send({ error: "ambiguous_path" });
          }
          if (!scopeAllows(authenticated.scopes, request.method, applicationPath)) {
            metrics.authorizationDenied += 1;
            securityMetrics.recordAuthorizationDenial();
            audit(request, { event: "auth.scope_denied", channel, reason: "no_matching_scope" });
            return reply.code(403).send({ error: "client_access_forbidden" });
          }
          dispatchPath = canonicalDispatchPath(path);
          metrics.authorizationAllowed += 1;
        }
      } catch (error) {
        const message = errorMessage(error);
        if (message === "CHANNEL_NOT_FOUND") return reply.code(404).send({ error: "channel_not_found" });
        metrics.clientAuthFailures += 1;
        if (message === "CLIENT_CREDENTIAL_EXPIRED" || message === "CLIENT_CREDENTIAL_INVALID") {
          const reason = message === "CLIENT_CREDENTIAL_EXPIRED" ? "expired" : accessToken ? "invalid" : "missing";
          securityMetrics.recordAuthFailure(reason);
          audit(request, { event: "auth.client.rejected", channel, reason });
          return reply.code(401).send({ error: message === "CLIENT_CREDENTIAL_EXPIRED" ? "client_access_expired" : "client_access_unauthorized" });
        }
        if (brokerUnavailable(error, reply, request)) return;
        securityMetrics.recordBrokerError("operation");
        audit(request, { event: "broker.error", reason: "operation" });
        throw error;
      }
      metrics.proxyRequests += 1;
      const downstream = await broker.dispatch(channel, {
        method: request.method,
        path: dispatchPath,
        headers: filteredHeaders(request.headers, INBOUND_DENY),
        body: request.body,
      });

      const safeHeaders = filteredHeaders(downstream.headers ?? {}, isolatedHost ? OUTBOUND_DENY : SHARED_ORIGIN_DENY);
      const policies: string[] = [];
      for (const [name, value] of Object.entries(safeHeaders)) {
        const lower = name.toLowerCase();
        if (!isolatedHost && lower === "content-security-policy") {
          policies.push(...(Array.isArray(value) ? value : [value]));
          continue;
        }
        if (!isolatedHost && lower === "x-content-type-options") continue;
        reply.header(name, value as string);
      }
      if (!isolatedHost) {
        // Browsers enforce every CSP header, so the app's own policy still applies alongside the sandbox.
        reply.header("content-security-policy", (policies.length ? [...policies, SHARED_ORIGIN_SANDBOX] : SHARED_ORIGIN_SANDBOX) as string);
        reply.header("x-content-type-options", "nosniff");
      }
      const jsonBody = downstream.body !== null && typeof downstream.body === "object";
      if (jsonBody && !Object.keys(safeHeaders).some((name) => name.toLowerCase() === "content-type")) {
        reply.header("content-type", "application/json; charset=utf-8");
      }

      metrics.proxyResponses += 1;
      return reply.code(downstream.statusCode ?? 200).send(jsonBody ? JSON.stringify(downstream.body) : downstream.body);
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof BrokerCapacityError) {
        securityMetrics.recordCapacity("queued");
        audit(request, { event: "channel.capacity_rejected", channel, type: "queued" });
        return reply.header("retry-after", "1").code(429).send({ error: "channel_capacity_exceeded" });
      }
      if (message === "CHANNEL_NOT_FOUND") {
        return reply.code(404).send({ error: "channel_not_found" });
      }
      if (message === "DOWNSTREAM_TIMEOUT") {
        metrics.proxyTimeouts += 1;
        securityMetrics.recordTimeout();
        audit(request, { event: "request.timeout", channel });
        return reply.code(504).send({ error: "downstream_timeout" });
      }
      if (brokerUnavailable(error, reply, request)) return;
      metrics.brokerErrors += 1;
      securityMetrics.recordBrokerError("operation");
      audit(request, { event: "broker.error", reason: "operation" });
      throw error;
    }
  }

  function bearerToken(authorization: string | string[] | undefined) {
    if (typeof authorization !== "string") return "";
    return authorization.match(/^Bearer (.+)$/)?.[1] ?? "";
  }

  function clientAccessToken(headers: Record<string, string | string[] | undefined>) {
    return typeof headers["x-ap-access-token"] === "string" ? headers["x-ap-access-token"] : "";
  }

  function downstreamSecret(headers: Record<string, string | string[] | undefined>) {
    return typeof headers["x-ap-downstream-secret"] === "string" ? headers["x-ap-downstream-secret"] : "";
  }

  function requestPath(url: string, channel: string, fallback: string) {
    const suffix = url.slice(`/c/${channel}`.length);
    if (!suffix) return fallback;
    return suffix.startsWith("?") ? `/${suffix}` : suffix;
  }
}
