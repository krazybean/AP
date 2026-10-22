export type AuthFailureReason = "missing" | "invalid" | "expired" | "revoked";
export type InvalidHostReason = "malformed" | "invalid_channel" | "invalid_suffix";
export type CapacityType = "queued" | "in_flight";
export type ServiceAuthFailureReason = "missing" | "invalid";
export type AccountRejectionReason = "missing" | "invalid" | "not_owned" | "limit" | "disabled";

interface AuditBase {
  timestamp: string;
  requestId: string;
}

export type SecurityAuditEvent =
  | (AuditBase & { event: "channel.created"; channel: string; access: "public" | "bearer"; exposure: "path" | "isolated-host" })
  | (AuditBase & { event: "credential.created" | "credential.revoked"; channel: string; credentialId: string })
  | (AuditBase & { event: "auth.downstream.rejected"; channel: string; reason: "invalid_secret" })
  | (AuditBase & { event: "auth.client.rejected"; channel?: string; reason: AuthFailureReason })
  | (AuditBase & { event: "auth.scope_denied"; channel: string; reason: "no_matching_scope" })
  | (AuditBase & { event: "channel.capacity_rejected"; channel: string; type: CapacityType })
  | (AuditBase & { event: "origin.invalid_host"; reason: InvalidHostReason })
  | (AuditBase & { event: "origin.legacy_path_blocked"; channel: string })
  | (AuditBase & { event: "request.timeout"; channel: string })
  | (AuditBase & { event: "broker.unavailable" | "broker.error"; reason: "unavailable" | "operation" })
  | (AuditBase & { event: "service.created"; serviceId: string; name: string })
  | (AuditBase & { event: "service.instance_bound" | "service.instance_unbound"; serviceId: string; channel: string })
  | (AuditBase & { event: "service.auth_rejected"; reason: ServiceAuthFailureReason })
  | (AuditBase & { event: "account.key_created" | "account.key_revoked"; githubId: string; keyId: string })
  | (AuditBase & { event: "account.disabled" | "account.enabled"; githubId: string })
  | (AuditBase & { event: "account.rejected"; reason: AccountRejectionReason; githubId?: string });

export interface AuditSink {
  emit(event: SecurityAuditEvent): void;
}

export function createAuditEmitter(sink: AuditSink, onFailure: () => void) {
  return (event: SecurityAuditEvent) => {
    try {
      sink.emit(event);
    } catch {
      onFailure();
    }
  };
}

export function loggerAuditSink(logger: { info: (object: unknown, message?: string) => void }): AuditSink {
  return { emit: (event) => logger.info({ audit: event }, "security_audit") };
}

const eventKeys: Record<SecurityAuditEvent["event"], string[]> = {
  "channel.created": ["event", "timestamp", "requestId", "channel", "access", "exposure"],
  "credential.created": ["event", "timestamp", "requestId", "channel", "credentialId"],
  "credential.revoked": ["event", "timestamp", "requestId", "channel", "credentialId"],
  "auth.downstream.rejected": ["event", "timestamp", "requestId", "channel", "reason"],
  "auth.client.rejected": ["event", "timestamp", "requestId", "channel", "reason"],
  "auth.scope_denied": ["event", "timestamp", "requestId", "channel", "reason"],
  "channel.capacity_rejected": ["event", "timestamp", "requestId", "channel", "type"],
  "origin.invalid_host": ["event", "timestamp", "requestId", "reason"],
  "origin.legacy_path_blocked": ["event", "timestamp", "requestId", "channel"],
  "request.timeout": ["event", "timestamp", "requestId", "channel"],
  "broker.unavailable": ["event", "timestamp", "requestId", "reason"],
  "broker.error": ["event", "timestamp", "requestId", "reason"],
  "service.created": ["event", "timestamp", "requestId", "serviceId", "name"],
  "service.instance_bound": ["event", "timestamp", "requestId", "serviceId", "channel"],
  "service.instance_unbound": ["event", "timestamp", "requestId", "serviceId", "channel"],
  "service.auth_rejected": ["event", "timestamp", "requestId", "reason"],
  "account.key_created": ["event", "timestamp", "requestId", "githubId", "keyId"],
  "account.key_revoked": ["event", "timestamp", "requestId", "githubId", "keyId"],
  "account.disabled": ["event", "timestamp", "requestId", "githubId"],
  "account.enabled": ["event", "timestamp", "requestId", "githubId"],
  "account.rejected": ["event", "timestamp", "requestId", "reason", "githubId"],
};

const events = new Set(Object.keys(eventKeys));

export function isSecurityAuditEvent(value: unknown): value is SecurityAuditEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.event !== "string" || !events.has(record.event)) return false;
  if (typeof record.timestamp !== "string" || Number.isNaN(Date.parse(record.timestamp)) || typeof record.requestId !== "string" || record.requestId.length > 128 || /[\u0000-\u001f\u007f]/.test(record.requestId)) return false;
  const allowed = eventKeys[record.event as SecurityAuditEvent["event"]];
  if (Object.keys(record).some((key) => !allowed.includes(key))) return false;
  if (record.channel !== undefined && typeof record.channel !== "string") return false;
  if (record.credentialId !== undefined && typeof record.credentialId !== "string") return false;
  if (record.reason !== undefined && typeof record.reason !== "string") return false;
  if (record.event === "channel.created" &&
      (typeof record.channel !== "string" || (record.access !== "public" && record.access !== "bearer") || (record.exposure !== "path" && record.exposure !== "isolated-host"))) return false;
  if ((record.event === "credential.created" || record.event === "credential.revoked") &&
      (typeof record.channel !== "string" || typeof record.credentialId !== "string")) return false;
  if (record.event === "auth.client.rejected" &&
      (!(["missing", "invalid", "expired", "revoked"] as string[]).includes(String(record.reason)))) return false;
  if (record.event === "auth.downstream.rejected" && (record.reason !== "invalid_secret" || typeof record.channel !== "string")) return false;
  if (record.event === "auth.scope_denied" && (record.reason !== "no_matching_scope" || typeof record.channel !== "string")) return false;
  if (record.event === "channel.capacity_rejected" &&
      (typeof record.channel !== "string" || (record.type !== "queued" && record.type !== "in_flight"))) return false;
  if (record.event === "origin.invalid_host" &&
      !(["malformed", "invalid_channel", "invalid_suffix"] as string[]).includes(String(record.reason))) return false;
  if ((record.event === "origin.legacy_path_blocked" || record.event === "request.timeout") && typeof record.channel !== "string") return false;
  if ((record.event === "broker.unavailable" || record.event === "broker.error") &&
      !(["unavailable", "operation"] as string[]).includes(String(record.reason))) return false;
  if (record.event === "service.created" && (typeof record.serviceId !== "string" || typeof record.name !== "string")) return false;
  if ((record.event === "service.instance_bound" || record.event === "service.instance_unbound") &&
      (typeof record.serviceId !== "string" || typeof record.channel !== "string")) return false;
  if (record.event === "service.auth_rejected" && (record.reason !== "missing" && record.reason !== "invalid")) return false;
  if (record.githubId !== undefined && typeof record.githubId !== "string") return false;
  if ((record.event === "account.key_created" || record.event === "account.key_revoked") &&
      (typeof record.githubId !== "string" || typeof record.keyId !== "string")) return false;
  if ((record.event === "account.disabled" || record.event === "account.enabled") && typeof record.githubId !== "string") return false;
  if (record.event === "account.rejected" &&
      !(["missing", "invalid", "not_owned", "limit", "disabled"] as string[]).includes(String(record.reason))) return false;
  return true;
}

export interface SecurityMetricsSnapshot {
  authFailures: Record<AuthFailureReason, number>;
  authorizationDenials: { no_matching_scope: number };
  capacityRejections: Record<CapacityType, number>;
  requestTimeouts: number;
  brokerErrors: { unavailable: number; operation: number };
  invalidHosts: Record<InvalidHostReason, number>;
  legacyIsolatedPathBlocks: number;
  credentialsCreated: number;
  credentialsRevoked: number;
  channelsCreated: Record<"path_public" | "path_bearer" | "isolated_host_public" | "isolated_host_bearer", number>;
  auditEmissionFailures: number;
  servicesCreated: number;
  serviceBindings: number;
  serviceUnbindings: number;
  serviceAuthFailures: number;
  signInsStarted: number;
  accountKeysCreated: number;
  accountKeysRevoked: number;
  accountRejections: Record<AccountRejectionReason, number>;
}

export class SecurityMetrics {
  private readonly values: SecurityMetricsSnapshot = {
    authFailures: { missing: 0, invalid: 0, expired: 0, revoked: 0 },
    authorizationDenials: { no_matching_scope: 0 },
    capacityRejections: { queued: 0, in_flight: 0 },
    requestTimeouts: 0,
    brokerErrors: { unavailable: 0, operation: 0 },
    invalidHosts: { malformed: 0, invalid_channel: 0, invalid_suffix: 0 },
    legacyIsolatedPathBlocks: 0,
    credentialsCreated: 0,
    credentialsRevoked: 0,
    channelsCreated: { path_public: 0, path_bearer: 0, isolated_host_public: 0, isolated_host_bearer: 0 },
    auditEmissionFailures: 0,
    servicesCreated: 0,
    serviceBindings: 0,
    serviceUnbindings: 0,
    serviceAuthFailures: 0,
    signInsStarted: 0,
    accountKeysCreated: 0,
    accountKeysRevoked: 0,
    accountRejections: { missing: 0, invalid: 0, not_owned: 0, limit: 0, disabled: 0 },
  };

  recordAuthFailure(reason: AuthFailureReason) { this.values.authFailures[reason] += 1; }
  recordAuthorizationDenial() { this.values.authorizationDenials.no_matching_scope += 1; }
  recordCapacity(type: CapacityType) { this.values.capacityRejections[type] += 1; }
  recordTimeout() { this.values.requestTimeouts += 1; }
  recordBrokerError(type: "unavailable" | "operation") { this.values.brokerErrors[type] += 1; }
  recordInvalidHost(reason: InvalidHostReason) { this.values.invalidHosts[reason] += 1; }
  recordLegacyPathBlock() { this.values.legacyIsolatedPathBlocks += 1; }
  recordCredentialCreated() { this.values.credentialsCreated += 1; }
  recordCredentialRevoked() { this.values.credentialsRevoked += 1; }
  recordChannelCreated(access: "public" | "bearer", exposure: "path" | "isolated-host") {
    const key = `${exposure === "isolated-host" ? "isolated_host" : "path"}_${access}` as keyof SecurityMetricsSnapshot["channelsCreated"];
    this.values.channelsCreated[key] += 1;
  }
  recordAuditFailure() { this.values.auditEmissionFailures += 1; }
  recordServiceCreated() { this.values.servicesCreated += 1; }
  recordServiceBound() { this.values.serviceBindings += 1; }
  recordServiceUnbound() { this.values.serviceUnbindings += 1; }
  recordServiceAuthFailure() { this.values.serviceAuthFailures += 1; }
  recordSignInStarted() { this.values.signInsStarted += 1; }
  recordAccountKeyCreated() { this.values.accountKeysCreated += 1; }
  recordAccountKeyRevoked() { this.values.accountKeysRevoked += 1; }
  recordAccountRejection(reason: AccountRejectionReason) { this.values.accountRejections[reason] += 1; }
  snapshot(): SecurityMetricsSnapshot { return structuredClone(this.values); }
}
