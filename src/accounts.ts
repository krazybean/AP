import { randomBytes, randomUUID } from "node:crypto";

import { digestToken } from "./client-credentials.js";

export const ACCOUNT_KEY_PREFIX = "apk_";
export const DEVICE_ID_PREFIX = "apd_";
// Owner records outlive a channel's 15-minute idle expiry; each authenticated call refreshes them.
export const CHANNEL_OWNER_TTL_SECONDS = 24 * 60 * 60;
export const USAGE_DAYS = 8;
const LAST_USED_RESOLUTION_MS = 60_000;

export interface Account {
  githubId: string;
  login: string;
  createdAt: number;
  disabled: boolean;
}

export interface AccountKeyInfo {
  keyId: string;
  label?: string;
  createdAt: number;
  lastUsedAt?: number;
}

export interface AuthenticatedAccount {
  githubId: string;
  login: string;
  keyId: string;
}

export type SignInProvider = "github" | "google";

export interface DeviceLogin {
  // Records saved before Google sign-in have no provider and are GitHub's.
  provider?: SignInProvider;
  deviceCode: string;
  interval: number;
  expiresAt: number;
  nextPollAt: number;
}

export interface AccountUsage {
  account: Account;
  keys: AccountKeyInfo[];
  liveChannels: string[];
  channelsCreatedByDay: Record<string, number>;
}

export class AccountDisabledError extends Error {
  constructor() {
    super("ACCOUNT_DISABLED");
    this.name = "AccountDisabledError";
  }
}

export type IsLive = (channelId: string) => Promise<boolean>;

// Accounts let an operator tie channels and services to a GitHub identity and cut it off.
// Keys are stored only as SHA-256 digests, like channel secrets.
export interface AccountStore {
  saveDeviceLogin(deviceId: string, login: DeviceLogin): Promise<void>;
  deviceLogin(deviceId: string): Promise<DeviceLogin | undefined>;
  deleteDeviceLogin(deviceId: string): Promise<void>;
  // Counts one hit for key in a fixed window; false once the limit is reached.
  admit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
  createKey(githubId: string, login: string, label?: string): Promise<{ key: string; keyId: string }>;
  authenticateKey(key: string): Promise<AuthenticatedAccount | undefined>;
  listKeys(githubId: string): Promise<AccountKeyInfo[]>;
  revokeKey(githubId: string, keyId: string): Promise<boolean>;
  liveChannels(githubId: string, isLive: IsLive): Promise<string[]>;
  recordChannel(githubId: string, channelId: string): Promise<void>;
  channelOwner(channelId: string): Promise<string | undefined>;
  recordService(githubId: string, name: string): Promise<void>;
  serviceOwner(name: string): Promise<string | undefined>;
  usage(githubId: string, isLive: IsLive): Promise<AccountUsage | undefined>;
  listAccounts(): Promise<Account[]>;
  disableAccount(githubId: string): Promise<boolean>;
  enableAccount(githubId: string): Promise<boolean>;
}

export function newAccountKey() {
  const key = `${ACCOUNT_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, keyId: randomUUID(), digest: digestToken(key).toString("hex") };
}

export function newDeviceId() {
  return `${DEVICE_ID_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function keyDigest(key: string) {
  return digestToken(key).toString("hex");
}

export function usageDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function recentDays(now = Date.now()) {
  return Array.from({ length: USAGE_DAYS }, (_, index) => usageDay(now - index * 86_400_000));
}

export function lastUsedIsStale(lastUsedAt: number | undefined, now = Date.now()) {
  return lastUsedAt === undefined || now - lastUsedAt >= LAST_USED_RESOLUTION_MS;
}

interface StoredKey { githubId: string; keyId: string; label?: string; createdAt: number; lastUsedAt?: number }

export class MemoryAccountStore implements AccountStore {
  private readonly devices = new Map<string, { login: DeviceLogin; expiresAt: number }>();
  private readonly windows = new Map<string, { count: number; expiresAt: number }>();
  private readonly accounts = new Map<string, Account>();
  private readonly keys = new Map<string, StoredKey>();
  private readonly accountKeys = new Map<string, Map<string, string>>();
  private readonly accountChannels = new Map<string, Set<string>>();
  private readonly owners = new Map<string, { githubId: string; expiresAt: number }>();
  private readonly services = new Map<string, string>();
  private readonly created = new Map<string, number>();

  async saveDeviceLogin(deviceId: string, login: DeviceLogin) {
    this.devices.set(deviceId, { login, expiresAt: login.expiresAt });
  }

  async deviceLogin(deviceId: string) {
    const entry = this.devices.get(deviceId);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.devices.delete(deviceId);
      return undefined;
    }
    return { ...entry.login };
  }

  async deleteDeviceLogin(deviceId: string) {
    this.devices.delete(deviceId);
  }

  async admit(key: string, limit: number, windowSeconds: number) {
    const now = Date.now();
    for (const [name, window] of this.windows) if (window.expiresAt <= now) this.windows.delete(name);
    const window = this.windows.get(key) ?? { count: 0, expiresAt: now + windowSeconds * 1_000 };
    if (window.count >= limit) return false;
    window.count += 1;
    this.windows.set(key, window);
    return true;
  }

  async createKey(githubId: string, login: string, label?: string) {
    const account = this.accounts.get(githubId);
    if (account?.disabled) throw new AccountDisabledError();
    this.accounts.set(githubId, { githubId, login, createdAt: account?.createdAt ?? Date.now(), disabled: false });
    const created = newAccountKey();
    this.keys.set(created.digest, { githubId, keyId: created.keyId, createdAt: Date.now(), ...(label ? { label } : {}) });
    const keys = this.accountKeys.get(githubId) ?? new Map<string, string>();
    keys.set(created.keyId, created.digest);
    this.accountKeys.set(githubId, keys);
    return { key: created.key, keyId: created.keyId };
  }

  async authenticateKey(key: string) {
    const stored = this.keys.get(keyDigest(key));
    if (!stored) return undefined;
    const account = this.accounts.get(stored.githubId);
    if (!account || account.disabled) return undefined;
    if (lastUsedIsStale(stored.lastUsedAt)) stored.lastUsedAt = Date.now();
    return { githubId: stored.githubId, login: account.login, keyId: stored.keyId };
  }

  async listKeys(githubId: string) {
    const digests = [...(this.accountKeys.get(githubId)?.values() ?? [])];
    return digests.flatMap((digest) => {
      const stored = this.keys.get(digest);
      return stored ? [keyInfo(stored)] : [];
    }).sort((a, b) => a.createdAt - b.createdAt);
  }

  async revokeKey(githubId: string, keyId: string) {
    const keys = this.accountKeys.get(githubId);
    const digest = keys?.get(keyId);
    if (!keys || !digest) return false;
    keys.delete(keyId);
    this.keys.delete(digest);
    return true;
  }

  async liveChannels(githubId: string, isLive: IsLive) {
    const channels = this.accountChannels.get(githubId) ?? new Set<string>();
    for (const channel of [...channels]) if (!(await isLive(channel))) channels.delete(channel);
    return [...channels];
  }

  async recordChannel(githubId: string, channelId: string) {
    const channels = this.accountChannels.get(githubId) ?? new Set<string>();
    channels.add(channelId);
    this.accountChannels.set(githubId, channels);
    this.owners.set(channelId, { githubId, expiresAt: Date.now() + CHANNEL_OWNER_TTL_SECONDS * 1_000 });
    const day = `${githubId}:${usageDay()}`;
    this.created.set(day, (this.created.get(day) ?? 0) + 1);
  }

  async channelOwner(channelId: string) {
    const owner = this.owners.get(channelId);
    if (!owner || owner.expiresAt <= Date.now()) {
      this.owners.delete(channelId);
      return undefined;
    }
    owner.expiresAt = Date.now() + CHANNEL_OWNER_TTL_SECONDS * 1_000;
    return owner.githubId;
  }

  async recordService(githubId: string, name: string) {
    this.services.set(name, githubId);
  }

  async serviceOwner(name: string) {
    return this.services.get(name);
  }

  async usage(githubId: string, isLive: IsLive) {
    const account = this.accounts.get(githubId);
    if (!account) return undefined;
    return {
      account: { ...account },
      keys: await this.listKeys(githubId),
      liveChannels: await this.liveChannels(githubId, isLive),
      channelsCreatedByDay: Object.fromEntries(recentDays().map((day) => [day, this.created.get(`${githubId}:${day}`) ?? 0])),
    };
  }

  async listAccounts() {
    return [...this.accounts.values()].map((account) => ({ ...account })).sort((a, b) => a.createdAt - b.createdAt);
  }

  async disableAccount(githubId: string) {
    const account = this.accounts.get(githubId);
    if (!account) return false;
    account.disabled = true;
    for (const digest of this.accountKeys.get(githubId)?.values() ?? []) this.keys.delete(digest);
    this.accountKeys.delete(githubId);
    return true;
  }

  async enableAccount(githubId: string) {
    const account = this.accounts.get(githubId);
    if (!account) return false;
    account.disabled = false;
    return true;
  }
}

export function keyInfo(stored: StoredKey): AccountKeyInfo {
  return {
    keyId: stored.keyId,
    createdAt: stored.createdAt,
    ...(stored.label ? { label: stored.label } : {}),
    ...(stored.lastUsedAt ? { lastUsedAt: stored.lastUsedAt } : {}),
  };
}

export type { StoredKey };
