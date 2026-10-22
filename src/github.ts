// GitHub OAuth device flow: AP asks GitHub for a code, the person approves it on github.com,
// and AP exchanges the approval for a short-lived GitHub token it uses once to read the user's id.
// See https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

export interface DeviceCodeGrant {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DeviceTokenResult =
  | { status: "approved"; accessToken: string }
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "expired" }
  | { status: "denied" };

export interface GitHubUser {
  id: string;
  login: string;
}

export interface GitHubDeviceClient {
  startDevice(): Promise<DeviceCodeGrant>;
  pollToken(deviceCode: string): Promise<DeviceTokenResult>;
  user(accessToken: string): Promise<GitHubUser>;
}

export class GitHubError extends Error {
  constructor(message = "GITHUB_ERROR", options?: ErrorOptions) {
    super(message, options);
    this.name = "GitHubError";
  }
}

const GITHUB_TIMEOUT_MS = 10_000;

export class FetchGitHubDeviceClient implements GitHubDeviceClient {
  constructor(private readonly clientId: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async request(url: string, init: RequestInit) {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) });
    } catch (error) {
      throw new GitHubError("GITHUB_UNREACHABLE", { cause: error });
    }
    const body = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") throw new GitHubError(`GITHUB_HTTP_${response.status}`);
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
    // No scope: AP only needs the public profile to learn who approved the code.
    const { body } = await this.request("https://github.com/login/device/code", this.form({ client_id: this.clientId }));
    if (typeof body.device_code !== "string" || typeof body.user_code !== "string" || typeof body.verification_uri !== "string") {
      throw new GitHubError(typeof body.error === "string" ? `GITHUB_${body.error.toUpperCase()}` : "GITHUB_BAD_DEVICE_RESPONSE");
    }
    return {
      deviceCode: body.device_code,
      userCode: body.user_code,
      verificationUri: body.verification_uri,
      expiresIn: Number(body.expires_in) || 900,
      interval: Number(body.interval) || 5,
    };
  }

  async pollToken(deviceCode: string): Promise<DeviceTokenResult> {
    const { body } = await this.request("https://github.com/login/oauth/access_token", this.form({
      client_id: this.clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }));
    if (typeof body.access_token === "string") return { status: "approved", accessToken: body.access_token };
    switch (body.error) {
      case "authorization_pending": return { status: "pending" };
      case "slow_down": return { status: "slow_down", interval: Number(body.interval) || 10 };
      case "expired_token": return { status: "expired" };
      case "access_denied": return { status: "denied" };
      default: throw new GitHubError(typeof body.error === "string" ? `GITHUB_${body.error.toUpperCase()}` : "GITHUB_BAD_TOKEN_RESPONSE");
    }
  }

  async user(accessToken: string): Promise<GitHubUser> {
    const { status, body } = await this.request("https://api.github.com/user", {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${accessToken}`, "user-agent": "ap-sign-in" },
    });
    if (status !== 200 || typeof body.id !== "number" || typeof body.login !== "string") throw new GitHubError(`GITHUB_HTTP_${status}`);
    return { id: String(body.id), login: body.login };
  }
}

export function githubClientFromEnv(): GitHubDeviceClient | undefined {
  const clientId = process.env.AP_GITHUB_CLIENT_ID?.trim();
  return clientId ? new FetchGitHubDeviceClient(clientId) : undefined;
}
