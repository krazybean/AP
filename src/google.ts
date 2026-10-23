// Google OAuth device flow, the same shape as the GitHub client: AP asks Google for a code, the person
// approves it at google.com/device, and AP exchanges the approval for a short-lived access token it uses
// once to read who approved. Scopes are `openid email` only.
// See https://developers.google.com/identity/protocols/oauth2/limited-input-device

import type { DeviceCodeGrant, DeviceTokenResult, GitHubDeviceClient, GitHubUser } from "./github.js";

export type GoogleDeviceClient = GitHubDeviceClient;

export class GoogleError extends Error {
  constructor(message = "GOOGLE_ERROR", options?: ErrorOptions) {
    super(message, options);
    this.name = "GoogleError";
  }
}

// Google says the account exists but has not proven it owns the email; AP treats that as a refused sign-in.
export class GoogleUnverifiedEmailError extends GoogleError {
  constructor() {
    super("GOOGLE_EMAIL_NOT_VERIFIED");
    this.name = "GoogleUnverifiedEmailError";
  }
}

const GOOGLE_TIMEOUT_MS = 10_000;
const GOOGLE_SUB = /^\d{1,40}$/;
const ERROR_CODE = /^[a-z_]{1,40}$/;

// Only a short snake_case code from Google reaches logs; anything else is dropped.
function errorReason(error: unknown, fallback: string) {
  return typeof error === "string" && ERROR_CODE.test(error) ? `GOOGLE_${error.toUpperCase()}` : fallback;
}

export class FetchGoogleDeviceClient implements GoogleDeviceClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(url: string, init: RequestInit) {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
    } catch (error) {
      throw new GoogleError("GOOGLE_UNREACHABLE", { cause: error });
    }
    const body = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") throw new GoogleError(`GOOGLE_HTTP_${response.status}`);
    return { status: response.status, body };
  }

  private form(fields: Record<string, string>) {
    return {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    };
  }

  async startDevice(): Promise<DeviceCodeGrant> {
    const { body } = await this.request("https://oauth2.googleapis.com/device/code", this.form({ client_id: this.clientId, scope: "openid email" }));
    // Google names the field verification_url; accept the RFC 8628 spelling too.
    const verificationUri = typeof body.verification_url === "string" ? body.verification_url : body.verification_uri;
    if (typeof body.device_code !== "string" || typeof body.user_code !== "string" || typeof verificationUri !== "string") {
      throw new GoogleError(errorReason(body.error, "GOOGLE_BAD_DEVICE_RESPONSE"));
    }
    return {
      deviceCode: body.device_code,
      userCode: body.user_code,
      verificationUri,
      expiresIn: Number(body.expires_in) || 1800,
      interval: Number(body.interval) || 5,
    };
  }

  async pollToken(deviceCode: string): Promise<DeviceTokenResult> {
    // Unlike GitHub, Google requires the client secret on this call. It stays in this request body.
    const { body } = await this.request("https://oauth2.googleapis.com/token", this.form({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }));
    if (typeof body.access_token === "string") return { status: "approved", accessToken: body.access_token };
    switch (body.error) {
      case "authorization_pending": return { status: "pending" };
      case "slow_down": return { status: "slow_down", interval: Number(body.interval) || 10 };
      case "expired_token": return { status: "expired" };
      case "access_denied": return { status: "denied" };
      default: throw new GoogleError(errorReason(body.error, "GOOGLE_BAD_TOKEN_RESPONSE"));
    }
  }

  async user(accessToken: string): Promise<GitHubUser> {
    const { status, body } = await this.request("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
    });
    if (status !== 200 || typeof body.sub !== "string" || !GOOGLE_SUB.test(body.sub) || typeof body.email !== "string") {
      throw new GoogleError(`GOOGLE_HTTP_${status}`);
    }
    if (body.email_verified !== true && body.email_verified !== "true") throw new GoogleUnverifiedEmailError();
    if (body.email.length > 254 || /[\u0000-\u001f\u007f]/.test(body.email)) throw new GoogleError("GOOGLE_BAD_EMAIL");
    return { id: `google:${body.sub}`, login: body.email };
  }
}

// Both variables are required; with either missing Google sign-in is off.
export function googleClientFromEnv(): GoogleDeviceClient | undefined {
  const clientId = process.env.AP_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.AP_GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? new FetchGoogleDeviceClient(clientId, clientSecret) : undefined;
}
