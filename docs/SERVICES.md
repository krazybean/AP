# Named services

AP 1.1 adds a durable logical service identity above ephemeral channels.

## Contract

`POST /services` accepts `{ "name": "billing" }`. Names are lower-case DNS labels: 1–63 characters, `[a-z0-9]` with internal hyphens allowed, and no leading or trailing hyphen. `api`, `ap`, `health`, `metrics`, `channels`, and `services` are reserved. Names are never normalized.

The `201` response contains `serviceId`, `name`, `createdAt`, and an `aps_` ownership secret. The secret is returned only by creation; AP stores only its SHA-256 digest. Duplicate names return `409`. Creation is rate-limited per source.

`GET /services/:name` performs exact-name discovery. It is intentionally public because the response contains no credential, secret, token, digest, Redis key, or request data. It returns currently live channel instances with their AP URL, access mode, and exposure mode. There is no global service list.

`PUT /services/:name/instances/:channel` and `DELETE /services/:name/instances/:channel` require both `X-AP-Service-Secret` and `X-AP-Downstream-Secret`. Binding is idempotent, a channel can belong to at most one service, and each service supports at most 16 live instances. Unbinding is idempotent and never deletes the channel.

Stale memberships are filtered lazily during discovery and removed from the broker index. Discovery does not poll channels. Memory and Redis brokers implement the same service operations; Redis uniqueness and binding membership use atomic scripts.

Service deletion and name reuse are deliberately deferred. This keeps service identity stable and avoids ambiguous ownership/reclaim semantics. AP 1.1 does not add service routing, load balancing, service-scoped credentials, `/s/{service}` URLs, or application-level authorization.

Service lifecycle and rejected ownership authentication are emitted through the bounded security telemetry schema. Secrets are never logged, forwarded, or included in telemetry.
