# Integrating an Application with AP

This document describes the **current implemented AP uplink**. It is intended to be enough for another application to implement the handshake without importing AP code.

## Roles

- **AP** is the public rendezvous/proxy.
- **APP** is the self-describing application contract.
- **Downstream** is the private application process.
- **Client** is the AI or other HTTP client using the public channel URL.

The downstream initiates every AP infrastructure connection. The client never creates the channel.

## 1. Create a channel

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

Retain `channel` and `secret` for the uplink loop. The absolute public URL is the AP origin plus `url`. Keep the secret private; it authorizes downstream polling and response delivery.

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

A successful handoff returns HTTP `202`.

## 5. Share the public URL

Give the AI client:

```text
https://ap.krazybean.com/c/{channel}
```

The client starts there. It should be able to read the APP landing page, discover capabilities, and make ordinary HTTP requests beneath the same channel URL.

The AI does **not** need to know about `/channels`, polling, Redis, or the private application's network location.

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

The executable reference is [../scripts/mock-downstream.ts](../scripts/mock-downstream.ts).

## Error behavior currently implemented

- Unknown channel on public traffic: `404 {"error":"channel_not_found"}`
- Unknown channel while polling/responding: HTTP `404`
- Missing or invalid downstream secret while polling/responding: HTTP `401`
- Malformed downstream response envelope: HTTP `400`
- Channel creation over the source limit: HTTP `429`
- Downstream does not answer a dispatched public request in time: `504 {"error":"downstream_timeout"}`
- Timed-out requests cannot be completed later; their response is rejected as `request_not_found`.
- Poll completes without a request: HTTP `204`

Redis and the in-memory broker reject response IDs that are not currently pending for the channel. This is request ownership within the channel, not a replacement for broader client authentication.

## Integration rules

Keep the AP adapter thin. Application capabilities belong behind the application's APP boundary; do not encode application-specific semantics into AP.

Keep channel identity separate from the polling transport. The current implementation polls, but applications should not design their domain model around polling being permanent.

Do not expose secrets in the APP landing page or capability responses. Channel creation remains public in the prototype; the returned secret protects downstream polling and response delivery, while public AI-facing traffic remains reachable through the channel URL.

## Current lifecycle limitation

Channel creation exists; durable application identity and channel reclaim do not yet. A downstream should currently expect to create a new channel when starting rather than depending on a permanent public URL.

The current implementations expire channels after 15 minutes without activity. Reconnecting applications create a new channel. This lifetime is an implementation default, not yet a stable protocol guarantee, and durable channel reclaim is not implemented.
