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
