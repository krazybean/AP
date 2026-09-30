import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { ClientScope } from "./client-scopes.js";

export const CLIENT_TOKEN_PREFIX = "apc_";
export const CLIENT_CREDENTIAL_LIMIT = 10;

export interface ClientCredentialMetadata {
  id: string;
  createdAt: number;
  expiresAt?: number;
  scopes?: ClientScope[];
}

export interface CreatedClientCredential extends ClientCredentialMetadata {
  token: string;
}

export function createClientCredential(scopes?: ClientScope[]): CreatedClientCredential & { digest: Buffer } {
  const token = `${CLIENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { id: randomUUID(), token, digest: digestToken(token), createdAt: Date.now(), ...(scopes ? { scopes } : {}) };
}

export function digestToken(token: string) {
  return createHash("sha256").update(token).digest();
}

export function tokenDigestsMatch(token: string, digest: Buffer) {
  const supplied = digestToken(token);
  return supplied.length === digest.length && timingSafeEqual(supplied, digest);
}
