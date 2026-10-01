import { randomBytes, randomUUID } from "node:crypto";

import { digestToken, tokenDigestsMatch } from "./client-credentials.js";
import type { AccessMode, ExposureMode } from "./broker.js";

export const SERVICE_INSTANCE_LIMIT = 16;
export const SERVICE_SECRET_PREFIX = "aps_";
export const SERVICE_RESERVED_NAMES = new Set(["api", "ap", "health", "metrics", "channels", "services"]);

export interface ServiceRecord {
  serviceId: string;
  name: string;
  createdAt: string;
}

export interface ServiceInstance {
  channel: string;
  accessMode: AccessMode;
  exposureMode: ExposureMode;
}

export interface ServiceSnapshot {
  service: ServiceRecord;
  instances: ServiceInstance[];
}

export interface CreatedService extends ServiceRecord {
  secret: string;
}

export function validateServiceName(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) || SERVICE_RESERVED_NAMES.has(value)) {
    throw new Error("INVALID_SERVICE_NAME");
  }
  return value;
}

export function createService(): CreatedService & { digest: Buffer } {
  const secret = `${SERVICE_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { serviceId: randomUUID(), name: "", createdAt: new Date().toISOString(), secret, digest: digestToken(secret) };
}

export function serviceSecretMatches(secret: string, digest: Buffer | string) {
  return tokenDigestsMatch(secret, typeof digest === "string" ? Buffer.from(digest, "hex") : digest);
}
