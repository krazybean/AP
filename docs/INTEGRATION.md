# Integrating an Application with AP

This document describes the **current implemented AP uplink**. It is intended to be enough for another application to implement the handshake without importing AP code.

## Roles

- **AP** is the public rendezvous/proxy.
- **APP** is the self-describing application contract.
- **Downstream** is the private application process.
- **Client** is the AI or other HTTP client using the public channel URL.

The downstream initiates every AP infrastructure connection. The client never creates the channel.

## 1. Create a channel

If the AP you use requires accounts, send your AP key as `X-AP-Key` on this call and on every polling, response and access-token call below. [ACCOUNTS.md](ACCOUNTS.md) shows how to get one.

The downstream sends:

```http
POST https://ap.krazybean.com/channels
```

AP returns HTTP `201`:

```json
{
  "channel": "7505df58-1b0a-4d68-ac06-1bd7b3fa613a",
  "secret": "<downstream channel secret>",
  "url": "/c/7505df58-1b0a-4d68-ac06-1bd7b3fa613a"
}
```

Omitting `access` preserves the public-channel behavior. To create a protected channel, request bearer client access explicitly:

```http
POST /channels
Content-Type: application/json

{"access":{"mode":"bearer"}}
```

The response includes the downstream `secret` and one raw client token. An optional scoped initial credential can be requested:

```json
{
  "access": {
    "mode": "bearer",
    "scopes": [{ "methods": ["GET"], "path": "/projects/*" }]
  }
}
```

```json
{
  "channel": "...",
  "secret": "<downstream channel secret>",
  "url": "/c/...",
  "access": { "mode": "bearer", "credentialId": "...", "token": "apc_<random-token>" }
}
```

The raw `apc_` token is returned only at creation. Store it in the public client that is allowed to use the channel; AP stores only a SHA-256 digest. `X-AP-Access-Token` authorizes public channel traffic and is never forwarded downstream. The ordinary `Authorization` header remains application data and is forwarded unchanged when present.

Retain `channel` and `secret` for the uplink loop. The absolute public URL is the AP origin plus `url`. Keep the secret private; it authorizes downstream polling and response delivery.

### Browser-origin isolation

Omitting `exposure` uses the deployment's default, which is the shared path channel unless the operator sets `AP_DEFAULT_EXPOSURE=isolated-host`; always use the `url` AP returns. For browser-origin separation, configure AP's trusted `AP_CHANNEL_BASE_DOMAIN` (for example `channels.ap.krazybean.com`) and request `{"exposure":{"mode":"isolated-host"}}`. AP returns an absolute URL such as `https://<channel>.channels.ap.krazybean.com/`; each isolated channel hostname is a distinct browser origin. AP never derives this URL from `Host`, `X-Forwarded-Host`, or `Forwarded`; an unset or malformed base domain rejects isolated creation with `503`.

On an isolated hostname, every path—including `/health`, `/metrics`, and `/channels`—is downstream application traffic. The shared `/c/{channel}` form returns `404` for isolated channels. Configure `*.channels.<AP-domain>` on the AP deployment for production; DNS and wildcard certificate provisioning are deployment responsibilities.

## 2. Poll for public requests

The downstream repeatedly calls:

```http
GET /channels/{channel}/next
Authorization: Bearer <downstream channel secret>
```

AP holds the request briefly while waiting. HTTP `204` means no request was available during that wait; issue another poll.

When a public request exists, AP returns a pending-request envelope:

```json
{
  "id": "<request uuid>",
  "method": "GET",
  "path": "/projects",
  "headers": {
    "accept": "*/*"
  },
  "body": null
}
```

Treat `id` as the correlation ID required to return the result. `method`, `path`, headers, and body represent the request to the downstream application.

Do not prepend `/c/{channel}` locally. AP has already removed the public channel prefix.

## 3. Dispatch locally

Route the pending request through the application's APP-facing HTTP/router boundary.

Examples:

```text
pending path /          -> application /
pending path /projects  -> application /projects
```

The root response should be the APP 1.0 landing page described in [APP-1.0.md](APP-1.0.md).

## 4. Return the response

Post the downstream result to:

```http
POST /channels/{channel}/responses/{requestId}
Content-Type: application/json
Authorization: Bearer <downstream channel secret>
```

Envelope:

```json
{
  "statusCode": 200,
  "headers": {
    "content-type": "application/json"
  },
  "body": {
    "projects": []
  }
}
```

`statusCode` and `headers` are optional. AP defaults the public status to `200` when no status is supplied.

- `statusCode`, when present, must be an integer from `200` to `599`. Informational `1xx` codes cannot be a final response.
- Every header name and value must be a valid HTTP header (no spaces in names, no CR, LF or NUL in values). Otherwise AP answers `400 invalid_response`, and the request stays pending so you can send a corrected response.
- AP sends an object `body` as JSON. It sets `Content-Type: application/json` unless you supply a content type.
- AP drops hop-by-hop, forwarding, `Set-Cookie`, `Content-Encoding` and `Content-Length` headers, because it re-serializes the body itself.

A successful handoff returns HTTP `202`.

## 5. Share the public URL

Give the AI client:

```text
https://ap.krazybean.com/c/{channel}
```

The client starts there. It should be able to read the APP landing page, discover capabilities, and make ordinary HTTP requests beneath the same channel URL.

For an isolated channel, give the client the absolute URL returned by creation instead; do not rewrite it to `/c/{channel}`.

Every AP response includes `X-AP-Request-ID`. AP generates this identifier; client-supplied `X-AP-Request-ID` values are not trusted or reused. Use the returned value when correlating an AP response with operational audit records. It carries no authorization meaning.

The AI does **not** need to know about `/channels`, polling, Redis, or the private application's network location.

For a protected channel, public requests include:

```http
X-AP-Access-Token: apc_<client-token>
Authorization: Bearer <downstream-application-token>
```

Missing, invalid, revoked, or expired client tokens receive HTTP `401`. Public channels do not require `X-AP-Access-Token`.

## Client credential lifecycle

The downstream owner can create and revoke additional bearer credentials without introducing a user-account system:

```http
POST /channels/{channel}/access-tokens
X-AP-Downstream-Secret: <downstream channel secret>
Content-Type: application/json

{"expiresAt":"2030-01-01T00:00:00.000Z"}
```

Revocation uses:

```http
DELETE /channels/{channel}/access-tokens/{credentialId}
X-AP-Downstream-Secret: <downstream channel secret>
```

The control header is deliberately separate from ordinary `Authorization`, which remains reserved for downstream application semantics and the existing polling/response transport. At most 10 active credentials are retained per channel. Credential metadata endpoints never return raw tokens or digests.

## Credential-scoped authorization

Authentication answers which credential may call AP. Authorization answers which HTTP operation that credential may dispatch. A credential created without `scopes` is unrestricted for compatibility. A credential with scopes is deny-by-default and matches only explicit HTTP methods and application paths:

```json
{"scopes":[
  {"methods":["GET"],"path":"/projects/*"},
  {"methods":["POST"],"path":"/generate"}
]}
```

Paths are either exact (`/projects`) or trailing subtree wildcards (`/projects/*`); `/*` matches all application paths. Queries are ignored for authorization but preserved for downstream dispatch. Methods are matched explicitly and normalized to uppercase; `GET` does not imply `HEAD`. Scope arrays are immutable and limited to 32 rules. Replace a scoped credential to change its permissions, then revoke the old one. Valid credentials that fail scope matching receive `403`; failed authentication remains `401`.

## Minimal loop

Pseudocode:

```text
created = POST AP/channels
channel = created.channel
secret = created.secret

forever:
    pending = GET AP/channels/{channel}/next
              Authorization: Bearer {secret}

    if pending.status == 204:
        continue

    result = dispatch_locally(
        method = pending.method,
        path = pending.path,
        headers = pending.headers,
        body = pending.body
    )

    POST AP/channels/{channel}/responses/{pending.id}
    Authorization: Bearer {secret} {
        statusCode: result.status,
        headers: result.headers,
        body: result.body
    }
```

The executable reference is [../scripts/mock-downstream.ts](../scripts/mock-downstream.ts). For the shortest working app, with a step-by-step walkthrough, see [EXAMPLE.md](EXAMPLE.md) and [../examples/hello-app.mjs](../examples/hello-app.mjs).

## Error behavior currently implemented

- Unknown channel on public traffic: `404 {"error":"channel_not_found"}`
- Unknown channel while polling/responding: HTTP `404`
- Missing or invalid downstream secret while polling/responding: HTTP `401`
- Malformed downstream response envelope: HTTP `400`
- Channel creation over the source limit: HTTP `429`
- AP key missing while accounts are required: `401 {"error":"account_required"}`; unknown or revoked key: `401 {"error":"account_key_invalid"}`
- Channel made by another account's key: `403 {"error":"channel_not_owned"}`
- Account already at its live-channel limit: `429 {"error":"account_channel_limit"}`
- Downstream does not answer a dispatched public request in time: `504 {"error":"downstream_timeout"}`
- Timed-out requests cannot be completed later; their response is rejected as `request_not_found`.
- Poll completes without a request: HTTP `204`

Redis and the in-memory broker reject response IDs that are not currently pending for the channel. This is request ownership within the channel, not a replacement for broader client authentication.

## Integration rules

Keep the AP adapter thin. Application capabilities belong behind the application's APP boundary; do not encode application-specific semantics into AP.

Keep channel identity separate from the polling transport. The current implementation polls, but applications should not design their domain model around polling being permanent.

Do not expose secrets in the APP landing page or capability responses. Channel creation is public unless the operator requires accounts; public channels remain reachable through the channel URL, while protected channels additionally require the AP client token. The downstream secret protects polling, responses, and credential control.

## Current lifecycle limitation

Named services are created with `POST /services`, discovered with exact `GET /services/:name`, and populated with the two-secret bind endpoint. Discovery is not a credential grant: the returned instance URL still enforces the channel's access mode, and the service secret is never returned by discovery. A service has at most 16 channel instances; service deletion and name reuse are not implemented.

Channel creation exists; durable application identity and channel reclaim do not yet. A downstream should currently expect to create a new channel when starting rather than depending on a permanent public URL.

The current implementations expire channels after 15 minutes without activity. Reconnecting applications create a new channel. This lifetime is an implementation default, not yet a stable protocol guarantee, and durable channel reclaim is not implemented.
