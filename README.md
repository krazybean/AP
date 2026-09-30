# AP — AI Traffic Plane

**Give private AI-capable applications a public HTTPS surface.**

> **AP routes intelligence. It does not provide intelligence.**

AP is a lightweight traffic layer for AI systems. A private application connects **outward** to AP, and AP gives it a public HTTPS endpoint that an AI client can call like any normal web API.

No inbound port. No VPN. No ngrok. No AP-specific networking library on the client.

```text
AI client / agent / service
            │
            │ HTTPS
            ▼
    ┌───────────────┐
    │      AP       │
    │ traffic plane │
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

If NGINX sits in front of web applications, **AP is intended to become that kind of traffic layer for AI-facing applications, models, agents, tools, and services.**

Today AP is the working foundation: public channels, request forwarding, response correlation, shared broker state, expiry, basic rate limiting, and a small application-discovery contract. The broader routing layer is the roadmap, not a claim about features that already exist.

Production endpoint: `https://ap.krazybean.com`

---

## Why AP exists

AI systems increasingly need to call things that are not naturally public:

- a tool running on a developer laptop
- an agent inside a private network
- a local model or model gateway
- an internal application
- a homelab service
- a desktop application exposing selected capabilities
- a service that should not accept arbitrary inbound network connections

AP gives those systems a common public edge without forcing the private application to become public infrastructure itself.

A useful mental model is:

```text
private capability + outbound connection + AP = public HTTPS capability
```

### Example

Suppose a local application exposes:

```text
GET /projects
GET /projects/:id
POST /projects/:id/refresh
```

The application connects to AP and receives a public URL such as:

```text
https://ap.krazybean.com/c/abc123
```

An AI client can then call:

```text
GET https://ap.krazybean.com/c/abc123/projects
```

AP forwards the request to the private application, the application handles it locally, and AP returns the response to the client.

The client does not need to know where the application is running or how the private uplink works.

---

## What AP is — and what it is not

| AP is | AP is not |
| --- | --- |
| An AI traffic layer | An AI model |
| A public rendezvous point | An agent framework |
| A reverse proxy for private AI-facing applications | A prompt framework |
| A transport boundary between clients and private services | A replacement for application logic |
| A foundation for routing, discovery, policy, and failover | A system that decides what your application should do |

AP should stay boring in the best possible way: **move requests, enforce traffic rules, expose capabilities, and stay out of application judgment.**

---

## AP vs. MCP

AP and [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) solve different problems.

**MCP defines how an AI host interacts with a capability server. AP provides the traffic path and public boundary that can make private AI-facing services reachable.**

### Side-by-side topology

<table>
<tr>
<th width="50%">Model Context Protocol (MCP)</th>
<th width="50%">AI Proxy (AP)</th>
</tr>
<tr>
<td valign="top"><pre>
┌────────────────────┐
│ AI host            │
│ Claude / IDE / app │
│                    │
│  ┌──────────────┐  │
│  │ MCP client   │  │
│  └──────┬───────┘  │
└─────────┼──────────┘
          │
          │ MCP
          │ stdio or HTTP
          ▼
   ┌──────────────┐
   │ MCP server   │
   │ tools        │
   │ resources    │
   │ prompts      │
   └──────────────┘
</pre>
<strong>Primary question:</strong><br><br>
How does the AI application interact with this capability server?
</td>
<td valign="top"><pre>
┌────────────────────┐
│ AI client / agent  │
└─────────┬──────────┘
          │
          │ normal HTTPS
          ▼
   ┌──────────────┐
   │      AP      │
   │ public edge  │
   └──────┬───────┘
          │
          │ outbound uplink
          ▼
   ┌──────────────┐
   │ private app  │
   │ capabilities │
   └──────────────┘
</pre>
<strong>Primary question:</strong><br><br>
How does traffic reach this private capability without exposing the private network?
</td>
</tr>
</table>

MCP is a protocol for exposing and consuming tools, resources, prompts, and related capabilities between MCP clients and servers. AP is transport and routing infrastructure around AI-facing services.

The MCP diagram above is logical topology: an MCP server may be local or remote, and MCP supports more than one transport. AP's concern is different — reachability, traffic flow, and eventually routing policy around those services.

### They can work together

```text
AI host
  │
  │ MCP
  ▼
MCP client
  │
  │ HTTPS
  ▼
 AP
  │
  │ private uplink
  ▼
MCP-capable private service
```

AP does not need to replace MCP. A future AP protocol adapter can route MCP traffic just as AP can route other AI-facing traffic.

---

## The five concepts

You only need five terms to understand the current system.

| Term | Plain-English meaning |
| --- | --- |
| **AP** | The public proxy and traffic service. |
| **APP** | **AI Proxy Protocol** — the small application contract used to describe what a connected app exposes. |
| **Channel** | The public URL assigned to one connected application. |
| **Downstream** | The private application connected to AP. |
| **Client** | The AI, agent, service, or other HTTP caller using the public channel. |

The distinction that matters most:

> **AP connects. APP describes. Your application decides what it can do.**

---

## How it works

The current uplink is intentionally simple HTTP long polling.

```text
1. Private app creates a channel
2. AP returns a channel ID, secret, and public URL
3. Private app waits for requests using outbound HTTP
4. Public requests arrive at /c/{channel}/...
5. AP hands the request to the private app
6. Private app executes it locally
7. Private app returns the response to AP
8. AP returns that response to the public client
```

The private application initiates every infrastructure connection. It does not need an inbound port.

Public requests map directly into the downstream namespace:

```text
https://ap.krazybean.com/c/abc123           -> /
https://ap.krazybean.com/c/abc123/projects  -> /projects
```

---

## APP — the application contract

APP (**AI Proxy Protocol**) is the small application-facing contract used by an application reachable through AP.

Its core idea is simple:

> **The root (`/`) tells an unfamiliar client what this application is and what it exposes.**

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

AP forwards this document. The application owns its routes, descriptions, schemas, authorization, and semantics.

The current shape is an interoperability baseline, **not yet a frozen APP 1.0 schema**. See [docs/APP-1.0.md](docs/APP-1.0.md).

---

## Quick start

### Run AP locally

Node.js 20.x is the currently validated runtime.

```bash
npm install
npm run build
npm test
npm run dev
```

AP defaults to:

```text
http://localhost:4117
```

### Connect the reference private application

In another terminal:

```bash
npm run mock:downstream
```

To connect the reference downstream to the hosted AP instance instead:

```bash
AP_URL=https://ap.krazybean.com npm run mock:downstream
```

The process prints its public channel URL. Requests sent to that URL are handed to the local process and returned through AP.

For a real application integration, see [docs/INTEGRATION.md](docs/INTEGRATION.md).

---

## Current HTTP surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | AP infrastructure health |
| `POST` | `/channels` | Create a channel |
| `GET` | `/channels/:channel/next` | Private application waits for the next request |
| `POST` | `/channels/:channel/responses/:requestId` | Private application returns a response |
| any | `/c/:channel[/...]` | Public client-facing channel namespace |

Channel creation currently returns HTTP `201`:

```json
{
  "channel": "<uuid>",
  "secret": "<downstream channel secret>",
  "url": "/c/<uuid>"
}
```

For exact request and response envelopes, see [docs/INTEGRATION.md](docs/INTEGRATION.md).

---

## Where AP is going

The goal is not to turn AP into an AI framework. The goal is to make it dependable traffic infrastructure for heterogeneous AI systems.

### AP 1.0 — dependable channels

- reliable channel lifecycle
- reconnects and durable identity
- authentication
- streaming
- health and operational hardening

### AP 1.x — discovery

- named services
- richer capability discovery
- multiple downstream instances

### AP 2.0 — routing

- declarative routing
- load balancing
- fallback and failover
- traffic policy
- rate limits and quotas
- retries, timeouts, and circuit breaking
- observability

### AP 3.0 — interoperability

- protocol adapters
- model, agent, tool, and service integrations
- an ecosystem around a stable AI traffic plane

The architectural rule remains the same at every stage:

> **AP routes intelligence. It does not provide intelligence.**

---

## Current status and boundaries

AP is a working prototype with an end-to-end transport path.

Production currently uses shared Redis state through Upstash. Local development falls back to the in-memory broker when Vercel/Upstash KV environment variables are absent. Vercel is the initial deployment target, not part of the AP contract.

Current defaults and limitations:

- Channels expire after 15 minutes without activity.
- Reconnecting applications currently create a new channel.
- Durable application identity and channel reclaim are not implemented yet.
- Channel creation is limited to 10 per source IP per hour by default.
- `REQUIRE_LICENSE=true` can require a non-empty `X-APP-License` header, but license values are not yet validated or persisted.
- AP does not yet provide a complete user-authentication or abuse-control model.
- The APP schema and security model are not frozen.

Use the hosted service for controlled development and experiments. Do not infer production guarantees that are not documented here.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for health, Redis outage, expiry, and restart procedures.

---

## Design principles

1. **Private applications connect outward.** AP should not require inbound access to the application.
2. **Use ordinary protocols whenever possible.** AI clients should see normal HTTPS, not unnecessary transport machinery.
3. **Applications own capability.** AP should not absorb application-specific logic.
4. **Transport can evolve independently.** Polling is an implementation choice, not the application model.
5. **Keep the traffic plane boring.** Reliability, routing, policy, and observability belong here; intelligence does not.

---

## License

See [LICENSE](LICENSE).