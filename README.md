# AP — AI Proxy

**AP connects. APP communicates. Applications define capability.**

AP is a public rendezvous and proxy service that gives private applications an ordinary HTTPS surface for AI clients.

```text
AI client ── HTTPS ──> AP public channel ──> polling uplink ──> private application
```

The private application connects **outward** to AP. It creates a channel, services requests for that channel, and gives the resulting public URL to an AI client. The AI client needs only normal web requests: no VPN, inbound port, ngrok, WebSocket, MCP, or AP-specific networking.

Production endpoint: `https://ap.krazybean.com`

> **Prototype warning:** AP currently has no user authentication or abuse controls. Channel creation is public; the returned channel secret only protects the private downstream uplink. Use the current service for controlled development and experiments.

## APP 1.0

APP (AI Proxy Protocol) is the application-facing contract. Its first invariant is:

> **The root (`/`) of an APP 1.0 application is its machine-readable landing page. It identifies the application and describes the routes or capabilities the application chooses to expose.**

AP does not author or interpret this document. The downstream application owns its routes, schemas, descriptions, and semantics.

A minimal landing page currently looks like:

```json
{
  "protocol": "APP/1.0",
  "application": "Example App",
  "description": "What this application lets an AI do.",
  "routes": [
    {
      "method": "GET",
      "path": "/projects",
      "description": "Lists projects visible to the AI."
    }
  ]
}
```

This shape is the current interoperability baseline, **not yet a frozen APP 1.0 schema**. See [docs/APP-1.0.md](docs/APP-1.0.md).

## Integrating a private application

The current uplink is deliberately boring HTTP long polling.

1. `POST /channels` to create a channel.
2. Save the returned channel ID, downstream secret, and public URL.
3. Repeatedly `GET /channels/{channel}/next` with the downstream secret.
4. A `204` means there is no request yet; poll again.
5. For a request, execute the corresponding local APP route.
6. `POST /channels/{channel}/responses/{requestId}` with its result and the downstream secret.
7. Give only the public `/c/{channel}` URL to the AI client.

Public requests map directly into the downstream namespace:

```text
https://ap.krazybean.com/c/abc123           -> /
https://ap.krazybean.com/c/abc123/projects  -> /projects
```

The channel root is therefore the application's APP landing page, not an AP handshake page.

For exact request/response envelopes and an implementation recipe, see [docs/INTEGRATION.md](docs/INTEGRATION.md). The working reference downstream is [scripts/mock-downstream.ts](scripts/mock-downstream.ts).

## AP HTTP surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | AP infrastructure health |
| `POST` | `/channels` | Create a channel |
| `GET` | `/channels/:channel/next` | Private downstream waits for the next request |
| `POST` | `/channels/:channel/responses/:requestId` | Private downstream returns a response |
| any | `/c/:channel[/...]` | Public AI-facing channel namespace |

Current channel creation returns HTTP `201`:

```json
{
  "channel": "<uuid>",
  "secret": "<downstream channel secret>",
  "url": "/c/<uuid>"
}
```

## Development

Node.js 20.x is the currently validated runtime.

```bash
npm install
npm run build
npm test
npm run dev
```

With Upstash credentials available, run the opt-in Redis integration checks:

```bash
AP_REDIS_INTEGRATION=1 npm test
```

Local AP defaults to `http://localhost:4117`. Set `PORT` or `HOST` to override it.
Channels expire after 15 minutes without activity. Reconnecting applications create a new channel. Channel creation is limited to 10 per source IP per hour by default; set `CHANNELS_PER_IP_PER_HOUR` to change the prototype limit. Set `REQUIRE_LICENSE=true` to require a non-empty `X-APP-License` header; license values are not validated or persisted yet.

Run the reference downstream locally:

```bash
npm run mock:downstream
```

Or connect it to production:

```bash
AP_URL=https://ap.krazybean.com npm run mock:downstream
```

It prints a public channel URL. While the mock remains running, requests to that URL are handed to the local process and returned through AP.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for health, Redis outage, expiry, and restart procedures.

## Deployment and state

Vercel is the initial deployment target, not part of the AP contract. Production uses shared Redis state through Upstash; local development falls back to the in-memory broker when the Vercel/Upstash KV environment variables are absent.

AP must remain conceptually deployable as a normal Node service. Transport implementation may evolve without changing APP application semantics.

## Current boundaries

The transport proof is working end-to-end. Several production concerns are intentionally unfinished: user authentication, durable application identity/channel reclaim, agreed channel lifetime, broader abuse controls, and the final APP schema/security model.

Do not infer guarantees for those concerns from the prototype implementation.
