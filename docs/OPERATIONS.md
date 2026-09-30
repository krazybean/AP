# AP Operations Runbook

## Broker selection

Set `AP_BROKER` explicitly in deployments:

- `AP_BROKER=memory` always uses the process-local in-memory broker, even when Redis credentials exist. Use this for local development and tests only.
- `AP_BROKER=redis` requires Redis credentials and fails startup/configuration clearly when they are absent. This is the recommended production setting on Vercel.
- `AP_BROKER=auto` preserves the legacy behavior: use Redis when credentials are present, otherwise use memory. `auto` is the default only for backwards compatibility.

Redis credentials may use the Upstash names `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` or the legacy Vercel KV names `KV_REST_API_URL` and `KV_REST_API_TOKEN`.

The in-memory broker is process-local. It is not safe as a horizontally scaled/serverless production substitute for Redis because channels and in-flight ownership do not span instances and are lost on restart.

## Health

`GET /health` checks the configured broker. A healthy response is HTTP `200` with `broker: "ok"` and `brokerType` set to `memory` or `redis`. Redis or broker failure returns HTTP `503` with `status: "degraded"`.

Broker health results are cached for at most one second, including failures, to limit Redis work during health-check bursts. Concurrent checks share one broker operation.

`GET /metrics` reports process-local counters for channel creation, rate limiting, proxy traffic, timeouts, broker errors, client authentication, credential creation/revocation, queued requests, and in-flight requests. The Redis broker additionally reports `redisCommands` and `redisPollCommands`. These counters reset when the process restarts; Redis-global aggregation is intentionally not implemented.

In production (`NODE_ENV=production`), `/metrics` returns `404` unless `AP_METRICS_TOKEN` is set and the request includes `Authorization: Bearer <token>`. Keep this token secret; if unset, metrics are disabled.

## HTTP boundary

`AP_REQUEST_BODY_LIMIT_BYTES` sets Fastify's maximum request body size in bytes. It defaults to `1048576` (1 MiB); set a positive integer appropriate for the largest expected application payload. Invalid values stop startup.

Broker pressure limits default to `AP_BROKER_MAX_QUEUED_PER_CHANNEL=100` and `AP_BROKER_MAX_IN_FLIGHT_PER_CHANNEL=20`. They apply per channel; Redis enforces them across AP instances. Channel creation limits use process-local state in memory mode and shared Redis counters in Redis mode. AP has no global request-rate limiter; configure an upstream edge/WAF control for internet-facing abuse protection.

## Edge/WAF deployment gate

The repository does not deploy a distributed edge limiter. Configure this before internet exposure, using the platform's source-aware controls:

| Route | Required policy |
|---|---|
| `/channels` | Strict anonymous/source rate limit and burst cap |
| `/c/*` | General request rate limit plus per-source burst cap |
| malformed/random `/c/*` probes | Reject or throttle before Redis invocation where the platform supports it |
| `/health` | Permit monitoring, cap abusive volume |
| `/metrics` | Keep application bearer protection; WAF is additional defense |

Verify the rules in the Vercel/provider dashboard and record deployment evidence. Do not describe these rules as deployed until that external step is complete. GitHub secret scanning and dependency-review settings are likewise repository-owner controls that must be enabled in GitHub settings when available.

When either per-channel capacity is full, public channel requests receive HTTP `429` with `Retry-After: 1` and `error: "channel_capacity_exceeded"`; clients should use backoff because that delay is a retry hint, not a guarantee that capacity has freed.

Channel and request path identifiers must be canonical UUID v4 values; malformed identifiers return `404` without broker access. AP removes standard hop-by-hop headers, headers named by `Connection`, inbound forwarding metadata, `Host`, and `Content-Length` before dispatch. Downstream `Set-Cookie`, hop-by-hop, and forwarding headers are not returned to the browser. Safe application headers and bodies continue through the proxy. Downstream responses are accepted only after `/next` has delivered their request; queued, late, and duplicate response IDs return `404`.

AP's channel URLs still act as capability addresses; this pass does not add client authorization. Channels also share AP's browser origin, so downstream browser content can still pose cross-channel risks through mechanisms other than cookies. A later security wave should add explicit client authorization and channel origin isolation. Per-channel capacity and channel-creation controls do not replace an upstream edge/WAF rate limiter, especially on serverless platforms.

## Client authorization

Channel identity is separate from public-client authorization:

- `channel` identifies the destination.
- The downstream secret proves private application ownership/control.
- `X-AP-Access-Token: apc_<random-token>` authorizes a public caller on protected bearer channels.

Omitted `access` on channel creation means `public` for compatibility. Explicit `access.mode=bearer` creates a protected channel and returns the initial raw token once. Tokens are SHA-256 digested, support expiry/revocation, and are limited to 10 active credentials per channel. AP never consumes or forwards the ordinary application `Authorization` header for client access; it strips `X-AP-Access-Token` before downstream dispatch. Owner credential control uses `X-AP-Downstream-Secret`.

## Redis command budget

The Redis broker deliberately avoids 100 ms busy polling. Upstash's REST API does not support blocking list or blocking stream reads, so AP uses bounded adaptive polling: 100 ms, 250 ms, 500 ms, 1 s, 2 s, then a 5 s cap.

Approximate command budgets after the hardening pass are:

| Flow | Redis commands |
| --- | ---: |
| First channel creation in a rate-limit bucket | 3 |
| Subsequent channel creation in the same bucket | 2 |
| Idle 25 s downstream `/next` poll | ~11 |
| Dispatch admission before waiting | 1 atomic Lua call |
| Response wait for 5 s | ~6 polling GETs |
| Response wait for 15 s | ~8 polling GETs |
| Response wait for 30 s | ~11 polling GETs |
| Downstream response submission | 3 |
| Timeout cleanup | 1 atomic Lua call; 1 additional read only if a response wins the timeout race |

The previous 100 ms polling path consumed roughly 253 commands for one idle 25 s `/next` request and roughly 50/150/300 response-key GETs for 5/15/30 second waits. Current capacity transitions are atomic Redis scripts; each counts as one command.

## Redis outage or quota exhaustion

1. Check `/health`, `/metrics`, and application logs.
2. Confirm `AP_BROKER=redis` and the configured Redis credentials are present in the deployment environment.
3. Check Upstash/Vercel status and quota/usage.
4. AP maps recognized Redis/provider infrastructure failures to HTTP `503` with `error: "broker_unavailable"`; if a safe retry delay is available it is forwarded as `Retry-After`.
5. Downstream clients should back off on `503` and must not hot-loop reconnect or long-poll attempts.
6. Restore Redis service/quota before sending new production traffic.
7. Treat in-flight requests as failed if their downstream timeout expires; callers may retry according to application semantics.

Do not switch production to the local in-memory broker merely to bypass a Redis outage.

## Channel expiry and restart

Channels expire after 15 minutes without activity. A reconnecting application creates a new channel and shares its new public URL. Redis-backed channels and pending request ownership survive an AP process restart while their TTLs remain valid.

## Deployment failure

Startup errors are logged and set a nonzero process exit code. Fix the bind/configuration error, redeploy, then verify `/health` before sharing a channel URL.
