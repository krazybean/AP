# AP Operations Runbook

## Health

`GET /health` checks the configured broker. A healthy response is HTTP `200` with `broker: "ok"`. Redis or broker failure returns HTTP `503` with `status: "degraded"`.

`GET /metrics` reports process-local counters for channel creation, rate limiting, proxy traffic, timeouts, broker errors, queued requests, and in-flight requests. These counters reset when the process restarts; Redis-global aggregation is intentionally not implemented yet.

## Redis outage

1. Check `/health` and application logs.
2. Confirm the configured `KV_REST_API_URL` and `KV_REST_API_TOKEN` are present in the deployment environment.
3. Check the Upstash/Vercel integration status.
4. Restore Redis connectivity before sending new traffic.
5. Treat in-flight requests as failed if their downstream timeout expires; clients may retry through a newly created channel.

Do not substitute the local in-memory broker for a production Redis outage. It is process-local and loses state on restart.

## Channel expiry and restart

Channels expire after 15 minutes without activity. A reconnecting application creates a new channel and shares its new public URL. Redis-backed channels and pending request ownership survive an AP process restart while their TTLs remain valid.

## Deployment failure

Startup errors are logged and set a nonzero process exit code. Fix the bind/configuration error, redeploy, then verify `/health` before sharing a channel URL.
