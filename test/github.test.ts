import assert from "node:assert/strict";
import test from "node:test";

import { FetchGitHubDeviceClient, GitHubError } from "../src/github.js";

function fakeFetch(responses: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const response = responses[url];
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("the GitHub client speaks the device flow without a client secret", async () => {
  const { calls, fetchImpl } = fakeFetch({
    "https://github.com/login/device/code": { body: { device_code: "dc", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 } },
    "https://github.com/login/oauth/access_token": { body: { access_token: "gho_x", token_type: "bearer" } },
    "https://api.github.com/user": { body: { id: 42, login: "octo" } },
  });
  const client = new FetchGitHubDeviceClient("Iv1.abc", fetchImpl);
  assert.deepEqual(await client.startDevice(), { deviceCode: "dc", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 });
  assert.deepEqual(await client.pollToken("dc"), { status: "approved", accessToken: "gho_x" });
  assert.deepEqual(await client.user("gho_x"), { id: "42", login: "octo" });

  const poll = new URLSearchParams(String(calls[1].init.body));
  assert.equal(poll.get("client_id"), "Iv1.abc");
  assert.equal(poll.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
  assert.equal(poll.has("client_secret"), false);
  assert.equal((calls[2].init.headers as Record<string, string>).authorization, "Bearer gho_x");
});

test("the GitHub client maps device-flow errors", async () => {
  for (const [error, expected] of [
    ["authorization_pending", { status: "pending" }],
    ["slow_down", { status: "slow_down", interval: 10 }],
    ["expired_token", { status: "expired" }],
    ["access_denied", { status: "denied" }],
  ] as const) {
    const { fetchImpl } = fakeFetch({ "https://github.com/login/oauth/access_token": { body: { error, ...(error === "slow_down" ? { interval: 10 } : {}) } } });
    assert.deepEqual(await new FetchGitHubDeviceClient("id", fetchImpl).pollToken("dc"), expected);
  }
  const { fetchImpl } = fakeFetch({ "https://github.com/login/device/code": { body: { error: "device_flow_disabled" } } });
  await assert.rejects(() => new FetchGitHubDeviceClient("id", fetchImpl).startDevice(), (error: unknown) =>
    error instanceof GitHubError && error.message === "GITHUB_DEVICE_FLOW_DISABLED");
});
