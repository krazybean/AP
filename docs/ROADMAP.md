# AP Roadmap

AP is evolving from a public rendezvous/proxy into a general AI traffic plane.

The roadmap is intentionally infrastructure-first. AP should become more capable at moving, routing, and governing traffic without absorbing model or application intelligence.

> **AP routes intelligence. It does not provide intelligence.**

## AP 1.0 — Dependable channels

Goal: make the current channel model reliable enough to serve as foundational infrastructure.

Planned work:

- reliable channel lifecycle
- reconnects and durable application identity
- authentication and authorization
- streaming
- health and operational hardening
- stable security and lifecycle semantics

## AP 1.x — Discovery

Goal: let clients and infrastructure understand what connected services provide without hard-coding individual endpoints.

Planned work:

- named services
- richer capability discovery
- multiple downstream instances
- service metadata suitable for routing decisions

## AP 2.0 — Routing

Goal: turn AP from a rendezvous point into a programmable traffic plane.

Planned work:

- declarative routing
- load balancing
- fallback and failover
- traffic policy
- rate limits and quotas
- retries and timeouts
- circuit breaking
- observability
- routing by service, capability, model, policy, or other stable metadata

## AP 3.0 — Interoperability

Goal: let heterogeneous AI systems share one traffic layer without requiring one application framework.

Planned work:

- protocol adapters
- model-provider integrations
- agent and tool integrations
- support for MCP and other AI-facing protocols where an adapter is useful
- ecosystem conventions around a stable AP traffic plane

## Versioning

AP follows [semantic versioning](https://semver.org/). `1.0.0` is the first stable release; before it, AP was pre-release.

**What the version number covers** (a breaking change here needs a major bump):

- HTTP routes, methods, status codes and the JSON error codes they return, such as `sign_in_expired` and `channel_not_owned`
- request and response envelopes in [INTEGRATION.md](INTEGRATION.md) and [SERVICES.md](SERVICES.md)
- environment variables and their documented values
- security semantics: authentication, authorization, ownership and origin isolation

**What it does not cover:**

- the APP document shape in [APP-1.0.md](APP-1.0.md), which is not frozen and has its own `APP/1.0` identifier
- internal names and storage layout, such as the `githubId` field and Redis key names
- reference scripts and examples
- the contents of operator-only views (`/admin/*`, `/metrics`) beyond the documented fields

**How versions move:**

- **Patch** (`1.2.x`, where AP is now): the normal release. Bug fixes, security fixes and small additive changes that break nothing, such as a new route, an optional request field, an env var that defaults to off, a new sign-in provider or a new error code for a new condition. Clients must tolerate unknown fields and unknown error codes, which is what makes additive patches safe.
- **Minor** (`1.x.0`): a larger capability the maintainer wants to announce, such as the discovery work planned for 1.x above. Not needed for ordinary additions.
- **Major** (`2.0.0`, `3.0.0`): removing or changing documented behavior. This is also where the routing (2.0) and interoperability (3.0) goals above land.
- A documented behavior is deprecated for at least one release, and noted in the changelog, before a major release removes it.
- Security fixes may tighten behavior in any release when the old behavior was unsafe. These are called out in the changelog.

**Cutting a release:**

1. Move the `Unreleased` changelog entries under a dated version heading.
2. Set the version in `package.json`, `package-lock.json` and `apVersion` in `src/server.ts`.
3. Merge to `main`, then tag `vX.Y.Z` on the merge commit.

## Non-goals

AP is not intended to become:

- a model
- a prompt framework
- an agent framework
- an orchestration engine for application judgment
- a place for application-specific business logic

Those systems may communicate through AP. They should not have to become part of AP.

## Current implementation

The current implementation is the foundation for AP 1.0 plus AP 1.1 named services. It provides public and protected channels, request forwarding, response correlation, shared Redis-backed state in production, inactivity expiry, health checks, prototype rate limiting, credential-scoped authorization, opt-in browser-origin isolation through trusted per-channel hostnames, and exact-name service discovery with bounded channel membership.

Features listed above remain planned until implemented and documented as current behavior.
