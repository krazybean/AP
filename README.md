# AP (AI Proxy)

[![CI](https://github.com/krazybean/AP/actions/workflows/ci.yml/badge.svg)](https://github.com/krazybean/AP/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Node](https://img.shields.io/badge/node-24.x-brightgreen.svg)](package.json)

**Give a private application a public HTTPS URL that AI clients can call.**

> **AP routes intelligence. It does not provide intelligence.**

A private application connects **outward** to AP, and AP gives it a public HTTPS endpoint. An AI client, agent or service calls that endpoint like any web API, and AP hands each request to the private app and returns its response.

The private app needs no inbound port, no VPN and no tunnel agent: it talks to AP over ordinary outbound HTTPS.

```text
AI client / agent / service
            │
            │ HTTPS
            ▼
    ┌───────────────┐
    │      AP       │
    │  public edge  │
    └───────┬───────┘
            │
            │ outbound-only uplink
            ▼
    ┌───────────────┐
    │  private app  │
    │ laptop / LAN  │
    │ lab / server  │
    └───────────────┘
```

---

## Try it in a minute

New to AP? [docs/EXAMPLE.md](docs/EXAMPLE.md) walks you through putting a tiny app online in five steps.

Requires Node.js 24.x.

```bash
npm install
npm run dev                  # terminal 1: AP on http://localhost:4117
npm run mock:downstream      # terminal 2: a private app connects and prints its public URL
```

Call the private app through AP, using the URL the second command printed:

```bash
curl http://localhost:4117/c/<channel>/ping
# {"pong":true}

curl -X POST http://localhost:4117/c/<channel>/echo \
  -H 'content-type: application/json' -d '{"hello":"ap"}'
# {"echo":{"hello":"ap"}}

curl http://localhost:4117/c/<channel>/
# the app's APP description: what it is and which routes it exposes
```

To connect the reference app to the hosted instance instead, run `AP_URL=https://apchannels.dev npm run mock:downstream`. Add `AP_EXPOSURE=isolated-host` to give the channel its own hostname such as `<channel>.apchannels.dev`.

To connect your own application, see [docs/INTEGRATION.md](docs/INTEGRATION.md). The uplink is plain HTTP, so any language with an HTTP client can implement it without an AP library.

---

## How it works

```text
1. The private app creates a channel:     POST /channels
2. AP returns a channel ID, a secret and a public URL
3. The private app waits for work:        GET  /channels/{channel}/next   (long poll)
4. A client calls the public URL:         ANY  /c/{channel}/...
5. AP hands the request to the private app
6. The private app handles it locally and returns the result:
                                          POST /channels/{channel}/responses/{requestId}
7. AP returns that response to the client
```

The private app opens every connection. Public paths map directly into its namespace:

```text
https://apchannels.dev/c/abc123           -> /
https://apchannels.dev/c/abc123/projects  -> /projects
```

### The five terms

| Term | Meaning |
| --- | --- |
| **AP** | The public proxy service. |
| **APP** | **AI Proxy Protocol**: the small contract an application uses to describe what it exposes. |
| **Channel** | The public URL assigned to one connected application. |
| **Downstream** | The private application connected to AP. |
| **Client** | The AI, agent, service or other HTTP caller using the channel. |

> **AP connects. APP describes. Your application decides what it can do.**

### APP: the application contract

The application's root (`/`) tells an unfamiliar client what the application is and what it exposes:

```json
{
  "protocol": "APP/1.0",
  "application": "Example App",
  "description": "What this application lets an AI do.",
  "routes": [
    { "method": "GET", "path": "/projects", "description": "Lists projects visible to the AI." }
  ]
}
```

AP forwards this document unchanged. The application owns its routes, schemas, authorization and semantics. The shape is a baseline, **not yet a frozen schema**; see [docs/APP-1.0.md](docs/APP-1.0.md).

---

## Why not ngrok or Cloudflare Tunnel?

If you need a general-purpose tunnel today, use one of them. They are mature, fast and carry any HTTP or TCP traffic. AP is narrower and earlier:

| | General tunnels (ngrok, Cloudflare Tunnel) | AP |
| --- | --- | --- |
| Private side runs | Their agent or CLI | Your own code making ordinary HTTPS calls |
| Traffic | Any HTTP or TCP, streaming | JSON request/response only, no streaming yet |
| Latency | Persistent connection, near-direct | Long polling; seconds of added delay are possible on the hosted Redis setup |
| Self-description | None | APP root document tells AI clients what the app exposes |
| Client access control | Product-specific | Per-channel bearer tokens with method and path scopes |
| Discovery | None | Named services that group live channels |

AP's bet is that AI-facing services need a traffic layer that understands applications, not just sockets: self-description now, then routing, failover and policy by service or capability. See [docs/ROADMAP.md](docs/ROADMAP.md).

## How AP relates to MCP

[MCP](https://modelcontextprotocol.io/) defines how an AI host talks to a capability server. AP is the traffic path that makes a private service reachable at all. They complement each other: an MCP-capable private service can sit behind AP. See [docs/AP-AND-MCP.md](docs/AP-AND-MCP.md).

---

## HTTP surface

Downstream (private app) endpoints authenticate with the channel secret, sent as `Authorization: Bearer <secret>` for polling and responses, or as `X-AP-Downstream-Secret` for credential and service management. Clients of a protected channel send their token as `X-AP-Access-Token`; the ordinary `Authorization` header is passed through to the app. When the operator requires accounts, the downstream also sends its AP key as `X-AP-Key` on every call below except `/health`, `/metrics`, `/auth/*`, service discovery and client traffic; see [docs/ACCOUNTS.md](docs/ACCOUNTS.md).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/`, `/privacy` | AP's landing page and privacy policy (HTML; text lives in `src/site.ts`) |
| `GET` | `/health` | AP and broker health |
| `GET` | `/metrics` | Operational counters (requires `AP_METRICS_TOKEN` in production) |
| `POST` | `/auth/device`, `/auth/device/token` | Sign in with GitHub (or Google, with `"provider":"google"`) and get an AP key |
| `GET`, `DELETE` | `/keys`, `/keys/:keyId` | List or revoke your AP keys |
| `GET`, `POST` | `/admin/accounts[/:id[/disable\|/enable]]` | Operator view of accounts and usage (requires `AP_ADMIN_TOKEN`) |
| `POST` | `/channels` | Create a channel; optional `access` (bearer tokens, scopes) and `exposure` (isolated host) |
| `GET` | `/channels/:channel/next` | Downstream waits for the next request |
| `POST` | `/channels/:channel/responses/:requestId` | Downstream returns a response |
| `POST` | `/channels/:channel/access-tokens` | Downstream issues a client token, optionally scoped and expiring |
| `DELETE` | `/channels/:channel/access-tokens/:credentialId` | Downstream revokes a client token |
| `POST` | `/services` | Create a named service |
| `GET` | `/services/:name` | Discover a service's live channels |
| `PUT`, `DELETE` | `/services/:name/instances/:channel` | Bind or unbind a channel (needs service and channel secrets) |
| any | `/c/:channel[/...]` | Public client traffic for a channel |
| any | `https://<channel>.<AP_CHANNEL_BASE_DOMAIN>/...` | Public client traffic for an isolated-host channel |

Request and response envelopes, protected channels and isolated hosts are documented in [docs/INTEGRATION.md](docs/INTEGRATION.md). Named services are in [docs/SERVICES.md](docs/SERVICES.md).

To give each channel its own hostname on a wildcard domain, follow [docs/SETUP.md](docs/SETUP.md).

---

## Current status

AP is a working prototype with an end-to-end transport path. What exists today:

- public and bearer-protected channels, with per-token method and path scopes, expiry and revocation
- request forwarding, response correlation, and per-channel queue and in-flight limits
- shared Redis state in production (Upstash) and an in-memory broker for local development
- opt-in per-channel hostnames for browser-origin isolation
- named services with exact-name discovery
- a fixed-schema security audit log and health checks

Current limits:

- Channels expire after 15 minutes without activity; reconnecting apps create a new channel.
- Bodies are JSON only and responses are not streamed.
- Channel creation is anonymous by default, limited to 10 per source IP per hour. Operators can require an AP key from GitHub or Google sign-in instead (`AP_REQUIRE_ACCOUNT=true`), which allows 10 live channels per account. `REQUIRE_LICENSE=true` only requires a non-empty `X-APP-License` header; license values are not validated yet.
- The APP schema and security model are not frozen.

Use the hosted service for development and experiments, and don't assume production guarantees that aren't documented. The security model is described in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) and [docs/SECURITY-BASELINE.md](docs/SECURITY-BASELINE.md); operations, including broker selection and Redis outages, in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Where AP is going

AP 1.0 makes channels dependable (durable identity, streaming, authentication). 1.x adds discovery, 2.0 adds routing (load balancing, failover, policy), and 3.0 adds protocol adapters. The full plan and non-goals are in [docs/ROADMAP.md](docs/ROADMAP.md).

## Design principles

1. **Private applications connect outward.** AP should not require inbound access to the application.
2. **Use ordinary protocols whenever possible.** AI clients should see normal HTTPS, not transport machinery.
3. **Applications own capability.** AP should not absorb application-specific logic.
4. **Transport can evolve independently.** Polling is an implementation choice, not the application model.
5. **Keep the traffic plane boring.** Reliability, routing, policy and observability belong here; intelligence does not.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
