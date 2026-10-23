import type { Redis } from "@upstash/redis";

import {
  AccountDisabledError,
  CHANNEL_OWNER_TTL_SECONDS,
  USAGE_DAYS,
  keyDigest,
  keyInfo,
  lastUsedIsStale,
  newAccountKey,
  recentDays,
  usageDay,
  type Account,
  type AccountStore,
  type DeviceLogin,
  type IsLive,
  type StoredKey,
} from "./accounts.js";

type Command = <T>(operation: () => Promise<T>) => Promise<T>;

function decode<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function hashReply(value: Record<string, string> | string[] | null): Record<string, string> | null {
  if (!Array.isArray(value)) return value;
  const record: Record<string, string> = {};
  for (let index = 0; index + 1 < value.length; index += 2) record[value[index]] = value[index + 1];
  return record;
}

export class RedisAccountStore implements AccountStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly command: Command,
  ) {}

  private key(...parts: string[]) {
    return `${this.prefix}${parts.join(":")}`;
  }

  async saveDeviceLogin(deviceId: string, login: DeviceLogin) {
    const ttl = Math.max(1, Math.ceil((login.expiresAt - Date.now()) / 1_000));
    await this.command(() => this.redis.set(this.key("device", keyDigest(deviceId)), JSON.stringify(login), { ex: ttl }));
  }

  async deviceLogin(deviceId: string) {
    return decode<DeviceLogin>(await this.command(() => this.redis.get(this.key("device", keyDigest(deviceId)))));
  }

  async deleteDeviceLogin(deviceId: string) {
    await this.command(() => this.redis.del(this.key("device", keyDigest(deviceId))));
  }

  async admit(name: string, limit: number, windowSeconds: number) {
    const key = this.key("window", name);
    const count = await this.command(() => this.redis.incr(key));
    if (count === 1) await this.command(() => this.redis.expire(key, windowSeconds));
    return count <= limit;
  }

  private async account(githubId: string): Promise<Account | undefined> {
    const record = hashReply(await this.command(() => this.redis.hgetall(this.key("account", githubId))) as Record<string, string> | string[] | null);
    if (!record?.login) return undefined;
    return { githubId, login: record.login, createdAt: Number(record.createdAt), disabled: record.disabled === "1" };
  }

  async createKey(githubId: string, login: string, label?: string) {
    const existing = await this.account(githubId);
    if (existing?.disabled) throw new AccountDisabledError();
    await this.command(() => this.redis.hset(this.key("account", githubId), {
      login,
      createdAt: String(existing?.createdAt ?? Date.now()),
      disabled: "0",
    }));
    await this.command(() => this.redis.sadd(this.key("accounts"), githubId));
    const created = newAccountKey();
    const stored: StoredKey = { githubId, keyId: created.keyId, createdAt: Date.now(), ...(label ? { label } : {}) };
    await this.command(() => this.redis.set(this.key("apikey", created.digest), JSON.stringify(stored)));
    await this.command(() => this.redis.hset(this.key("account-keys", githubId), { [created.keyId]: created.digest }));
    return { key: created.key, keyId: created.keyId };
  }

  async authenticateKey(key: string) {
    const digest = keyDigest(key);
    const stored = decode<StoredKey>(await this.command(() => this.redis.get(this.key("apikey", digest))));
    if (!stored) return undefined;
    const account = await this.account(stored.githubId);
    if (!account || account.disabled) return undefined;
    if (lastUsedIsStale(stored.lastUsedAt)) {
      await this.command(() => this.redis.set(this.key("apikey", digest), JSON.stringify({ ...stored, lastUsedAt: Date.now() })));
    }
    return { githubId: stored.githubId, login: account.login, keyId: stored.keyId };
  }

  async listKeys(githubId: string) {
    const record = hashReply(await this.command(() => this.redis.hgetall(this.key("account-keys", githubId))) as Record<string, string> | string[] | null) ?? {};
    const digests = Object.values(record);
    if (!digests.length) return [];
    const values = await this.command(() => this.redis.mget<(string | null)[]>(...digests.map((digest) => this.key("apikey", digest))));
    return values.flatMap((value) => {
      const stored = decode<StoredKey>(value);
      return stored ? [keyInfo(stored)] : [];
    }).sort((a, b) => a.createdAt - b.createdAt);
  }

  async revokeKey(githubId: string, keyId: string) {
    const digest = await this.command(() => this.redis.hget<string>(this.key("account-keys", githubId), keyId));
    if (!digest) return false;
    await this.command(() => this.redis.del(this.key("apikey", String(digest))));
    await this.command(() => this.redis.hdel(this.key("account-keys", githubId), keyId));
    return true;
  }

  async liveChannels(githubId: string, isLive: IsLive) {
    const key = this.key("account-channels", githubId);
    const channels = await this.command(() => this.redis.smembers<string[]>(key));
    const live: string[] = [];
    const dead: string[] = [];
    for (const channel of channels) ((await isLive(channel)) ? live : dead).push(channel);
    if (dead.length) await this.command(() => this.redis.srem(key, ...dead));
    return live;
  }

  async recordChannel(githubId: string, channelId: string) {
    await this.command(() => this.redis.sadd(this.key("account-channels", githubId), channelId));
    await this.command(() => this.redis.set(this.key("channel-owner", channelId), githubId, { ex: CHANNEL_OWNER_TTL_SECONDS }));
    const day = this.key("usage", githubId, usageDay());
    await this.command(() => this.redis.incr(day));
    await this.command(() => this.redis.expire(day, USAGE_DAYS * 86_400));
  }

  async channelOwner(channelId: string) {
    const owner = await this.command(() => this.redis.getex<string>(this.key("channel-owner", channelId), { ex: CHANNEL_OWNER_TTL_SECONDS }));
    return owner === null || owner === undefined ? undefined : String(owner);
  }

  async recordService(githubId: string, name: string) {
    await this.command(() => this.redis.set(this.key("service-owner", name), githubId));
    await this.command(() => this.redis.sadd(this.key("account-services", githubId), name));
  }

  async serviceOwner(name: string) {
    const owner = await this.command(() => this.redis.get<string>(this.key("service-owner", name)));
    return owner === null || owner === undefined ? undefined : String(owner);
  }

  async usage(githubId: string, isLive: IsLive) {
    const account = await this.account(githubId);
    if (!account) return undefined;
    const days = recentDays();
    const counts = await this.command(() => this.redis.mget<(string | null)[]>(...days.map((day) => this.key("usage", githubId, day))));
    return {
      account,
      keys: await this.listKeys(githubId),
      liveChannels: await this.liveChannels(githubId, isLive),
      channelsCreatedByDay: Object.fromEntries(days.map((day, index) => [day, Number(counts[index] ?? 0)])),
    };
  }

  async listAccounts() {
    const ids = await this.command(() => this.redis.smembers<string[]>(this.key("accounts")));
    const accounts: Account[] = [];
    for (const id of ids) {
      const account = await this.account(String(id));
      if (account) accounts.push(account);
    }
    return accounts.sort((a, b) => a.createdAt - b.createdAt);
  }

  async disableAccount(githubId: string) {
    const account = await this.account(githubId);
    if (!account) return false;
    await this.command(() => this.redis.hset(this.key("account", githubId), { disabled: "1" }));
    const record = hashReply(await this.command(() => this.redis.hgetall(this.key("account-keys", githubId))) as Record<string, string> | string[] | null) ?? {};
    const digests = Object.values(record);
    if (digests.length) await this.command(() => this.redis.del(...digests.map((digest) => this.key("apikey", digest))));
    await this.command(() => this.redis.del(this.key("account-keys", githubId)));
    return true;
  }

  async enableAccount(githubId: string) {
    if (!(await this.account(githubId))) return false;
    await this.command(() => this.redis.hset(this.key("account", githubId), { disabled: "0" }));
    return true;
  }

  async deleteAccount(githubId: string) {
    if (!(await this.account(githubId))) return false;
    const keys = hashReply(await this.command(() => this.redis.hgetall(this.key("account-keys", githubId))) as Record<string, string> | string[] | null) ?? {};
    const channels = await this.command(() => this.redis.smembers<string[]>(this.key("account-channels", githubId)));
    const services = await this.command(() => this.redis.smembers<string[]>(this.key("account-services", githubId)));
    const owned: string[] = [];
    for (const name of services) {
      if (await this.serviceOwner(String(name)) === githubId) owned.push(this.key("service-owner", String(name)));
    }
    const doomed = [
      ...Object.values(keys).map((digest) => this.key("apikey", digest)),
      ...channels.map((channel) => this.key("channel-owner", String(channel))),
      ...owned,
      ...recentDays().map((day) => this.key("usage", githubId, day)),
      this.key("account-keys", githubId),
      this.key("account-channels", githubId),
      this.key("account-services", githubId),
    ];
    await this.command(() => this.redis.del(...doomed));
    // The account record goes last so a failed delete can simply be retried.
    await this.command(() => this.redis.srem(this.key("accounts"), githubId));
    await this.command(() => this.redis.del(this.key("account", githubId)));
    return true;
  }
}
