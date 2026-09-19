# AP — AI Proxy

AP is a public rendezvous and proxy service for private applications that expose AI-facing capabilities.

The architectural split is intentionally small:

- **AP connects.** It gives a private application stable public addressability and hands ordinary HTTP traffic back and forth.
- **APP communicates.** AI Proxy Protocol is the application-neutral, self-describing contract applications use to advertise capabilities and interaction semantics.
- **Applications define capability.** AP does not contain Binder-, Loom-, or other application-specific knowledge.

```text
AI client ── ordinary HTTPS ──> AP channel ── traffic handoff ──> private application
```

An AI client does not discover AP or create a channel. A private application establishes an AP channel first and gives that public channel URL to the AI client. Normal HTTP requests are the baseline; an AI client does not need AP-specific networking support.

## APP 1.0 contract

APP 1.0 begins with one deliberately small invariant:

> The root (`/`) of an APP 1.0 application is its machine-readable landing page. It identifies the application and describes the routes or capabilities the application chooses to expose.

AP does **not** author, interpret, or maintain that landing page. The downstream application does.

Once a channel exists, AP maps the public channel namespace onto the downstream application:

```text
Public AP request              Downstream request
/c/abc123                  ->  /
/c/abc123/projects         ->  /projects
/c/abc123/context          ->  /context
```

Therefore an unfamiliar AI client can be given only the established channel URL, request its root, learn what the downstream application exposes, and then use those advertised routes.

The exact APP 1.0 landing-page schema is still being designed. Applications should not depend on an undocumented JSON shape yet.

## Designing an application for AP

An AP-compatible application should be designed around these boundaries:

1. **Implement APP 1.0 at the application boundary.** The application's root is self-describing and machine-readable.
2. **Own your capabilities.** Route names, descriptions, inputs, outputs, and application semantics belong to the application, not AP.
3. **Treat AP as transport infrastructure.** AP knows how to associate traffic with a channel; it should not need to understand application payloads.
4. **Use ordinary HTTP semantics.** A client that can make normal web requests should be able to interact through an established AP channel.
5. **Do not require the AI client to establish the channel.** The private application establishes or reclaims its channel before sharing the resulting public URL.
6. **Do not assume a permanent transport connection.** Channel identity and any particular uplink connection are separate concerns.

A minimal conceptual integration looks like this:

```text
Private application
      │
      │ establish / reclaim channel
      ▼
     AP
      │
      └── public channel URL
               │
               │ given to AI client
               ▼
           GET channel root
               │
               ▼
      downstream application /
               │
               └── APP 1.0 route index
```

### What the downstream must provide

At minimum, an APP-speaking downstream will provide:

- a machine-readable root landing page;
- identification of the APP protocol/version it implements;
- identification or description of the application;
- discovery information for the routes/capabilities it exposes.

The concrete schema for those fields will be specified as APP 1.0 evolves.

### What AP provides

AP is responsible for public channel addressability and traffic handoff. It is intentionally application-blind.

Infrastructure concerns such as channel creation/reclamation, authentication, channel lifetime, uplink transport, persistence, and the security model are still under design. They should not be inferred from the current scaffold.

## Current scope

The repository currently contains the AP service baseline and the first documented APP 1.0 application contract. Channel establishment and proxy routing are the next implementation work; they are not yet provided by the running service.

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

The development server defaults to port `4117`. Set `PORT` to override it.

Health check: `GET /health`

```json
{
  "status": "ok",
  "service": "ap"
}
```

Validate the project with:

```bash
npm run build
npm test
```

## Deployment

Vercel is the initial deployment target, not an architectural dependency. AP should remain deployable as a normal Node.js web service.
