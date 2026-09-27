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

`GET /metrics` reports process-local counters for channel creation, rate limiting, proxy traffic, timeouts, broker errors, queued requests, and in-flight requests. The Redis broker additionally reports `redisCommands` and `redisPollCommands`. These counters reset when the process restarts; Redis-global aggregation is intentionally not implemented.

## Redis command budget

The Redis broker deliberately avoids 100 ms busy polling. Upstash's REST API does not support blocking list or blocking stream reads, so AP uses bounded adaptive polling: 100 ms, 250 ms, 500 ms, 1 s, 2 s, then a 5 s cap.

Approximate command budgets after the hardening pass are:

| Flow | Redis commands |
| --- | ---: |
| First channel creation in a rate-limit bucket | 3 |
| Subsequent channel creation in the same bucket | 2 |
| Idle 25 s downstream `/next` poll | ~12 |
| Dispatch setup before waiting | 5 |
| Response wait for 5 s | ~6 polling GETs |
| Response wait for 15 s | ~8 polling GETs |
| Response wait for 30 s | ~11 polling GETs |
| Downstream response submission | 5 |
| Timeout cleanup | 2 |

The previous 100 ms polling path consumed roughly 253 commands for one idle 25 s `/next` request and roughly 50/150/300 response-key GETs for 5/15/30 second waits.

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
