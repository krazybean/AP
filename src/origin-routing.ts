import type { ExposureMode } from "./broker.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function normalizeBaseDomain(value: string) {
  const domain = value.trim().replace(/\.$/, "").toLowerCase();
  if (!domain || domain.length > 253 || domain.includes(":") || domain.includes("/") || domain.includes("?") || domain.includes("#") || domain.includes("*") || domain.split(".").some((label) => !LABEL.test(label))) {
    throw new Error("INVALID_CHANNEL_BASE_DOMAIN");
  }
  return domain;
}

function hostWithoutPort(value: string) {
  const host = value.trim();
  if (host.startsWith("[") || host.includes("/") || host.includes("?") || host.includes("#")) return null;
  const port = host.match(/:(\d+)$/);
  if (port && Number(port[1]) > 65_535) return null;
  return (port ? host.slice(0, -port[0].length) : host).replace(/\.$/, "").toLowerCase();
}

export function parseChannelHost(host: string, configuredBaseDomain: string) {
  const base = normalizeBaseDomain(configuredBaseDomain);
  const candidate = hostWithoutPort(host);
  if (!candidate || !candidate.endsWith(`.${base}`)) return null;
  const label = candidate.slice(0, -base.length - 1);
  return label && !label.includes(".") && UUID.test(label) ? label.toLowerCase() : null;
}

export function classifyChannelHost(host: string, configuredBaseDomain: string): string | "invalid" | null {
  const base = normalizeBaseDomain(configuredBaseDomain);
  const candidate = hostWithoutPort(host);
  if (!candidate || (candidate !== base && !candidate.endsWith(`.${base}`))) return null;
  const channel = parseChannelHost(host, base);
  return channel ?? "invalid";
}

export function classifyChannelHostFailure(host: string, configuredBaseDomain: string): "malformed" | "invalid_channel" | "invalid_suffix" | null {
  const base = normalizeBaseDomain(configuredBaseDomain);
  const candidate = hostWithoutPort(host);
  if (!candidate) return host ? "malformed" : null;
  if (candidate.endsWith(`.${base}`)) return "invalid_channel";
  const firstLabel = candidate.split(".", 1)[0];
  return UUID.test(firstLabel) && candidate.includes(`.${base}`) ? "invalid_suffix" : null;
}

export function buildChannelUrl(channel: string, configuredBaseDomain: string, mode: ExposureMode = "isolated-host") {
  const base = normalizeBaseDomain(configuredBaseDomain);
  if (mode !== "isolated-host" || !UUID.test(channel)) throw new Error("INVALID_CHANNEL_URL");
  return `https://${channel.toLowerCase()}.${base}/`;
}
