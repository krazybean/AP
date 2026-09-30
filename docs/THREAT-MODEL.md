# AP Threat Model

This is an engineering baseline, not a certification or a claim of OWASP compliance.

## Protected assets

- Downstream channel secrets and operational credentials.
- Request/response integrity and ownership.
- The private application's reachability boundary.
- Redis channel, queue, response, and capacity state.
- AP and downstream availability.
- Future client authorization state and audit data.

## Actors

Legitimate public clients, legitimate private downstreams, anonymous internet attackers, an attacker with a leaked channel URL, an attacker with a downstream secret, malicious downstream code, compromised dependencies, and infrastructure/provider failures.

## Trust boundaries

```text
Internet client -> AP public HTTP edge -> AP runtime -> Redis
                                      ^
                                      |
                         private downstream polling boundary
```

AP does not initiate connections into the private network. The downstream polls AP and submits responses using the channel secret.

## Entry points

`/health`, `/metrics`, `/channels`, downstream polling, downstream response submission, `/c/{channel}`, environment/configuration, CI, and dependencies.

## Threat register

| Threat | Current mitigation | Residual risk / future work |
|---|---|---|
| Channel enumeration and leaked URLs | UUID v4 validation, 404 for missing channels, creation rate limit | A valid capability remains usable; Wave 2 client authorization and edge throttling |
| Resource/queue exhaustion | Body limit, per-channel queued/in-flight caps, timeout cleanup | Distributed source throttling is an external WAF gate |
| Redis cost amplification | Bounded adaptive polling, health cache, shared atomic capacity scripts | Measure provider cost under real traffic |
| Forged forwarding metadata | Inbound forwarding and hop-by-hop headers removed | Upstream proxy semantics must be reviewed per deployment |
| Malicious downstream headers | Hop-by-hop, forwarding, and `Set-Cookie` response headers removed | Shared browser origin is not tenant isolation |
| Replay/request ownership attack | Secret required for downstream operations; response accepted only for delivered pending request | No client identity, expiry/revocation, or replay policy; Wave 2 |
| Oversized/slow payloads | Fastify body limit and bounded request timeouts | Edge limits and application-specific payload policy remain deployment concerns |
| Cross-origin tenant risk | Cookie filtering is defense in depth | Channel routes share `ap.krazybean.com`; isolate origins in Wave 2 |
| Dependency/CI compromise | Lockfile installs, audit, pinned actions, SBOM, supplemental scan | Enable GitHub secret scanning/dependency review externally |
| Credential leakage | No credentials committed; logs do not intentionally include secrets | Rotate outstanding deployment credential outside this repository |
| Redis/provider outage | Health checks, broker errors mapped to 503, no fallback in explicit Redis mode | Provider recovery and alerting are operational gates |

## Explicit non-goals

AP does not currently provide client authorization, tenant identity, revocation, or browser-origin isolation. These are Wave 2 design items and must not be inferred from a channel URL or the downstream secret.
