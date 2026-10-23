import type { FastifyInstance } from "fastify";

import { AccountDisabledError, DEVICE_ID_PREFIX, newDeviceId, type AuthenticatedAccount, type SignInProvider } from "./accounts.js";
import type { Broker } from "./broker.js";
import { GitHubError, githubClientFromEnv, type GitHubDeviceClient } from "./github.js";
import { GoogleError, GoogleUnverifiedEmailError, googleClientFromEnv, type GoogleDeviceClient } from "./google.js";
import type { AccountRejectionReason, SecurityAuditEvent, SecurityMetrics } from "./security-telemetry.js";

export const ACCOUNT_KEY_HEADER = "x-ap-key";
const SIGN_INS_PER_IP_PER_HOUR = 10;
const DEVICE_ID = new RegExp(`^${DEVICE_ID_PREFIX}[A-Za-z0-9_-]{32}$`);
// GitHub accounts are plain numeric ids; Google accounts are `google:` plus the numeric `sub`.
const GITHUB_ID = /^(?:\d{1,20}|google:\d{1,40})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// DELETE /account must send {"confirm":"delete-my-account"}.
const DELETE_CONFIRMATION = "delete-my-account";
const KEY_LABEL = /^[\x20-\x7e]{1,64}$/;

// With AP_REQUIRE_ACCOUNT=true every management and downstream call needs an account key.
// Left off (the default), anonymous use keeps working and keys are optional.
export function accountsRequired() {
  return process.env.AP_REQUIRE_ACCOUNT === "true";
}

export function accountChannelLimit() {
  const limit = Number(process.env.AP_ACCOUNT_CHANNEL_LIMIT ?? 10);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("AP_ACCOUNT_CHANNEL_LIMIT must be a positive integer");
  return limit;
}

type Headers = Record<string, string | string[] | undefined>;
type Reply = { code: (statusCode: number) => any; header: (name: string, value: string) => any };
type Audit = (request: { id: string }, event: { event: SecurityAuditEvent["event"]; [key: string]: unknown }) => void;

export interface AccountRouteDeps {
  broker: Broker;
  github?: GitHubDeviceClient;
  google?: GoogleDeviceClient;
  audit: Audit;
  securityMetrics: SecurityMetrics;
  brokerUnavailable: (error: unknown, reply: any, request?: { id: string }) => boolean;
  sourceKey: (ip: string | undefined) => string;
  adminAuthorized: (authorization: string | string[] | undefined) => boolean;
}

function accountKey(headers: Headers) {
  return typeof headers[ACCOUNT_KEY_HEADER] === "string" ? headers[ACCOUNT_KEY_HEADER] : "";
}

// Gate helpers run inside each route's existing try block, so broker outages reach its 503 handling.
export function createAccountGate({ broker, audit, securityMetrics }: Pick<AccountRouteDeps, "broker" | "audit" | "securityMetrics">) {
  function reject(request: { id: string }, reply: Reply, reason: AccountRejectionReason, status: number, error: string, githubId?: string) {
    securityMetrics.recordAccountRejection(reason);
    audit(request, { event: "account.rejected", reason, ...(githubId ? { githubId } : {}) });
    reply.code(status).send({ error });
    return false as const;
  }

  return {
    reject,

    // The caller's account; null when anonymous use is allowed; false once a rejection was sent.
    async caller(request: { id: string; headers: Headers }, reply: Reply, required = accountsRequired()): Promise<AuthenticatedAccount | null | false> {
      const key = accountKey(request.headers);
      if (!key) return required ? reject(request, reply, "missing", 401, "account_required") : null;
      const account = await broker.accounts.authenticateKey(key);
      return account ?? reject(request, reply, "invalid", 401, "account_key_invalid");
    },

    // A channel created with a key belongs to that account. Anonymous callers can still use
    // it while accounts are optional; once required, only the owner can.
    async channelAllowed(request: { id: string }, reply: Reply, account: AuthenticatedAccount | null, channel: string) {
      if (!account) return true;
      const owner = await broker.accounts.channelOwner(channel);
      if (owner === account.githubId) return true;
      if (owner === undefined && !accountsRequired()) return true;
      if (owner === undefined && !(await broker.hasChannel(channel))) {
        reply.code(404).send({ error: "channel_not_found" });
        return false;
      }
      return reject(request, reply, "not_owned", 403, "channel_not_owned", account.githubId);
    },

    async serviceAllowed(request: { id: string }, reply: Reply, account: AuthenticatedAccount | null, name: string) {
      if (!account) return true;
      const owner = await broker.accounts.serviceOwner(name);
      if (owner === account.githubId) return true;
      if (owner === undefined && !accountsRequired()) return true;
      if (owner === undefined && !(await broker.getService(name))) {
        reply.code(404).send({ error: "service_not_found" });
        return false;
      }
      return reject(request, reply, "not_owned", 403, "service_not_owned", account.githubId);
    },

    async channelSlotAvailable(request: { id: string }, reply: Reply, account: AuthenticatedAccount | null) {
      if (!account) return true;
      const live = await broker.accounts.liveChannels(account.githubId, (channel) => broker.hasChannel(channel));
      if (live.length < accountChannelLimit()) return true;
      return reject(request, reply, "limit", 429, "account_channel_limit", account.githubId);
    },
  };
}

export type AccountGate = ReturnType<typeof createAccountGate>;

export function registerAccountRoutes(app: FastifyInstance, deps: AccountRouteDeps) {
  const { broker, audit, securityMetrics, brokerUnavailable } = deps;
  const clients: Record<SignInProvider, GitHubDeviceClient | GoogleDeviceClient | undefined> = {
    github: deps.github ?? githubClientFromEnv(),
    google: deps.google ?? googleClientFromEnv(),
  };
  const gate = createAccountGate(deps);
  accountChannelLimit();

  // undefined: the client sent no provider. null: it sent something that is not a provider.
  function requestedProvider(value: unknown): SignInProvider | undefined | null {
    if (value === undefined) return undefined;
    return value === "github" || value === "google" ? value : null;
  }

  function providerFailed(error: unknown, reply: any, request: { id: string; log: { warn: (object: unknown, message?: string) => void } }) {
    if (error instanceof GoogleUnverifiedEmailError) {
      request.log.warn({ event: "google.error", reason: error.message }, "Google sign-in refused");
      reply.code(403).send({ error: "sign_in_denied" });
      return true;
    }
    const provider = error instanceof GitHubError ? "github" : error instanceof GoogleError ? "google" : undefined;
    if (!provider) return false;
    request.log.warn({ event: `${provider}.error`, reason: (error as Error).message }, `${provider} sign-in call failed`);
    reply.code(502).send({ error: `${provider}_error` });
    return true;
  }

  // Step 1: ask the provider for a code the person types in at its device page.
  app.post<{ Body: { provider?: unknown } | undefined }>("/auth/device", async (request, reply) => {
    const requested = requestedProvider(request.body?.provider);
    if (requested === null) return reply.code(400).send({ error: "unknown_provider" });
    const provider = requested ?? "github";
    const client = clients[provider];
    if (!client) return reply.code(503).send({ error: "sign_in_not_configured" });
    try {
      if (!(await broker.accounts.admit(`sign-in:${deps.sourceKey(request.ip)}`, SIGN_INS_PER_IP_PER_HOUR, 3_600))) {
        return reply.header("retry-after", "3600").code(429).send({ error: "sign_in_rate_limited" });
      }
      const grant = await client.startDevice();
      const deviceId = newDeviceId();
      const now = Date.now();
      await broker.accounts.saveDeviceLogin(deviceId, {
        provider,
        deviceCode: grant.deviceCode,
        interval: grant.interval,
        expiresAt: now + grant.expiresIn * 1_000,
        nextPollAt: now + grant.interval * 1_000,
      });
      securityMetrics.recordSignInStarted();
      return reply.code(201).send({ code: grant.userCode, url: grant.verificationUri, deviceId, expiresIn: grant.expiresIn, interval: grant.interval });
    } catch (error) {
      if (providerFailed(error, reply, request) || brokerUnavailable(error, reply, request)) return;
      throw error;
    }
  });

  // Step 2: poll until the person approves; the approval is swapped for an AP key once.
  app.post<{ Body: { deviceId?: unknown; label?: unknown; provider?: unknown } }>("/auth/device/token", async (request, reply) => {
    const requested = requestedProvider(request.body?.provider);
    if (requested === null) return reply.code(400).send({ error: "unknown_provider" });
    // A client that names a provider needs it configured; one that does not is judged by the stored login below.
    if (requested ? !clients[requested] : !clients.github && !clients.google) return reply.code(503).send({ error: "sign_in_not_configured" });
    const deviceId = request.body?.deviceId;
    const label = request.body?.label;
    if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) return reply.code(400).send({ error: "sign_in_expired" });
    if (label !== undefined && (typeof label !== "string" || !KEY_LABEL.test(label))) return reply.code(400).send({ error: "invalid_key_label" });
    try {
      const login = await broker.accounts.deviceLogin(deviceId);
      if (!login) return reply.code(400).send({ error: "sign_in_expired" });
      // The provider recorded at start decides who is polled; the client's claim can only agree with it.
      const provider = login.provider ?? "github";
      if (requested && requested !== provider) return reply.code(400).send({ error: "provider_mismatch" });
      const client = clients[provider];
      if (!client) return reply.code(503).send({ error: "sign_in_not_configured" });
      const now = Date.now();
      // Providers reject polls faster than their interval, so early polls are answered without asking.
      if (now < login.nextPollAt) return reply.code(202).send({ status: "waiting", interval: login.interval });
      const result = await client.pollToken(login.deviceCode);
      if (result.status === "pending" || result.status === "slow_down") {
        const interval = result.status === "slow_down" ? Math.max(result.interval, login.interval + 5) : login.interval;
        await broker.accounts.saveDeviceLogin(deviceId, { ...login, interval, nextPollAt: now + interval * 1_000 });
        return reply.code(202).send({ status: "waiting", interval });
      }
      await broker.accounts.deleteDeviceLogin(deviceId);
      if (result.status === "expired") return reply.code(400).send({ error: "sign_in_expired" });
      if (result.status === "denied") return reply.code(403).send({ error: "sign_in_denied" });
      const user = await client.user(result.accessToken);
      let created;
      try {
        created = await broker.accounts.createKey(user.id, user.login, label as string | undefined);
      } catch (error) {
        if (!(error instanceof AccountDisabledError)) throw error;
        gate.reject(request, reply, "disabled", 403, "account_disabled", user.id);
        return;
      }
      securityMetrics.recordAccountKeyCreated();
      audit(request, { event: "account.key_created", githubId: user.id, keyId: created.keyId });
      return reply.code(201).send({ key: created.key, keyId: created.keyId, login: user.login });
    } catch (error) {
      if (providerFailed(error, reply, request) || brokerUnavailable(error, reply, request)) return;
      throw error;
    }
  });

  app.get("/keys", async (request, reply) => {
    try {
      const account = await gate.caller(request, reply, true);
      if (!account) return;
      const keys = await broker.accounts.listKeys(account.githubId);
      return {
        login: account.login,
        keys: keys.map((key) => ({ ...key, createdAt: new Date(key.createdAt).toISOString(), ...(key.lastUsedAt ? { lastUsedAt: new Date(key.lastUsedAt).toISOString() } : {}), current: key.keyId === account.keyId })),
      };
    } catch (error) {
      if (brokerUnavailable(error, reply, request)) return;
      throw error;
    }
  });

  app.delete<{ Params: { keyId: string } }>("/keys/:keyId", async (request, reply) => {
    try {
      const account = await gate.caller(request, reply, true);
      if (!account) return;
      if (!UUID.test(request.params.keyId) || !(await broker.accounts.revokeKey(account.githubId, request.params.keyId))) {
        return reply.code(404).send({ error: "key_not_found" });
      }
      securityMetrics.recordAccountKeyRevoked();
      audit(request, { event: "account.key_revoked", githubId: account.githubId, keyId: request.params.keyId });
      return reply.code(204).send();
    } catch (error) {
      if (brokerUnavailable(error, reply, request)) return;
      throw error;
    }
  });

  // Self-service removal: the caller's own key proves who they are, and the body must say so on purpose
  // because nothing can be undone. Their keys stop working immediately; signing in again starts a fresh account.
  app.delete<{ Body: { confirm?: unknown } | undefined }>("/account", async (request, reply) => {
    try {
      const account = await gate.caller(request, reply, true);
      if (!account) return;
      if (request.body?.confirm !== DELETE_CONFIRMATION) return reply.code(400).send({ error: "confirmation_required" });
      if (!(await broker.accounts.deleteAccount(account.githubId))) return reply.code(404).send({ error: "account_not_found" });
      audit(request, { event: "account.deleted", githubId: account.githubId });
      return reply.code(204).send();
    } catch (error) {
      if (brokerUnavailable(error, reply, request)) return;
      throw error;
    }
  });

  // Operator view, hidden (404) unless AP_ADMIN_TOKEN is set and sent as a bearer token.
  app.get("/admin/accounts", async (request, reply) => {
    if (!deps.adminAuthorized(request.headers.authorization)) return reply.code(404).send({ error: "not_found" });
    try {
      const accounts = await broker.accounts.listAccounts();
      return { accounts: accounts.map((account) => ({ ...account, createdAt: new Date(account.createdAt).toISOString() })) };
    } catch (error) {
      if (brokerUnavailable(error, reply, request)) return;
      throw error;
    }
  });

  app.get<{ Params: { githubId: string } }>("/admin/accounts/:githubId", async (request, reply) => {
    if (!deps.adminAuthorized(request.headers.authorization)) return reply.code(404).send({ error: "not_found" });
    if (!GITHUB_ID.test(request.params.githubId)) return reply.code(404).send({ error: "account_not_found" });
    try {
      const usage = await broker.accounts.usage(request.params.githubId, (channel) => broker.hasChannel(channel));
      if (!usage) return reply.code(404).send({ error: "account_not_found" });
      return {
        ...usage,
        account: { ...usage.account, createdAt: new Date(usage.account.createdAt).toISOString() },
        keys: usage.keys.map((key) => ({ ...key, createdAt: new Date(key.createdAt).toISOString(), ...(key.lastUsedAt ? { lastUsedAt: new Date(key.lastUsedAt).toISOString() } : {}) })),
      };
    } catch (error) {
      if (brokerUnavailable(error, reply, request)) return;
      throw error;
    }
  });

  // For someone who lost their key and asked the operator to remove their data.
  app.delete<{ Params: { githubId: string } }>("/admin/accounts/:githubId", async (request, reply) => {
    if (!deps.adminAuthorized(request.headers.authorization)) return reply.code(404).send({ error: "not_found" });
    if (!GITHUB_ID.test(request.params.githubId)) return reply.code(404).send({ error: "account_not_found" });
    try {
      if (!(await broker.accounts.deleteAccount(request.params.githubId))) return reply.code(404).send({ error: "account_not_found" });
      audit(request, { event: "account.deleted", githubId: request.params.githubId });
      return reply.code(204).send();
    } catch (error) {
      if (brokerUnavailable(error, reply, request)) return;
      throw error;
    }
  });

  for (const action of ["disable", "enable"] as const) {
    app.post<{ Params: { githubId: string } }>(`/admin/accounts/:githubId/${action}`, async (request, reply) => {
      if (!deps.adminAuthorized(request.headers.authorization)) return reply.code(404).send({ error: "not_found" });
      if (!GITHUB_ID.test(request.params.githubId)) return reply.code(404).send({ error: "account_not_found" });
      try {
        const changed = action === "disable"
          ? await broker.accounts.disableAccount(request.params.githubId)
          : await broker.accounts.enableAccount(request.params.githubId);
        if (!changed) return reply.code(404).send({ error: "account_not_found" });
        audit(request, { event: action === "disable" ? "account.disabled" : "account.enabled", githubId: request.params.githubId });
        return reply.code(204).send();
      } catch (error) {
        if (brokerUnavailable(error, reply, request)) return;
        throw error;
      }
    });
  }

  return gate;
}
