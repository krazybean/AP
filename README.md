# AP — AI Proxy

AP is a public rendezvous and proxy service for private applications that expose AI-facing capabilities.

The architectural split is intentionally small:

- **AP connects.** It gives a private application stable public addressability and hands ordinary HTTP traffic back and forth.
- **APP communicates.** AI Proxy Protocol is the future application-neutral, self-describing contract applications use to advertise capabilities and interaction semantics.
- **Applications define capability.** AP does not contain Binder-, Loom-, or other application-specific knowledge.

```text
AI client ── ordinary HTTPS ──> AP ── traffic handoff ──> private application
```

An AI client should not require a persistent connection or AP-specific networking support. Normal web requests are the baseline. The private application's uplink transport is deliberately not defined yet.

## Current scope

This repository currently establishes only the AP service scaffold. APP discovery, capability schemas, channel lifecycle, authentication, uplink transport, persistence, and the security model are intentionally undecided.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Health check: `GET /health`

```json
{
  "status": "ok",
  "service": "ap"
}
```

Build with `npm run build`. Tests will be added as behavior is introduced.

## Deployment

Vercel is the initial deployment target, not an architectural dependency. AP should remain deployable as a normal Node.js web service.
