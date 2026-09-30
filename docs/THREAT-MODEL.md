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
| Channel enumeration and leaked URLs | UUID v4 validation, 404 for missing channels, creation rate limit, bearer client authorization and immutable transport scopes | A valid unrestricted credential remains usable; edge throttling is still required |
| Resource/queue exhaustion | Body limit, per-channel queued/in-flight caps, timeout cleanup | Distributed source throttling is an external WAF gate |
| Redis cost amplification | Bounded adaptive polling, health cache, shared atomic capacity scripts | Measure provider cost under real traffic |
| Forged forwarding metadata | Inbound forwarding and hop-by-hop headers removed | Upstream proxy semantics must be reviewed per deployment |
| Malicious downstream headers | Hop-by-hop, forwarding, and `Set-Cookie` response headers removed | Shared browser origin is not tenant isolation |
| Replay/request ownership attack | Secret required for downstream operations; client credentials support expiry/revocation; response accepted only for delivered pending request | No external identity, replay nonce, or business authorization |
| Oversized/slow payloads | Fastify body limit and bounded request timeouts | Edge limits and application-specific payload policy remain deployment concerns |
| Cross-origin tenant risk | Opt-in exact per-channel hostnames, downstream cookie filtering, no AP cookies, and no permissive CORS | Wildcard DNS/TLS and deployment host routing must be configured; CSP/COOP/COEP/CORP remain downstream/deployment policy |
| Dependency/CI compromise | Lockfile installs, audit, pinned actions, SBOM, supplemental scan | Enable GitHub secret scanning/dependency review externally |
| Credential leakage | No credentials committed; logs redact auth headers; raw client tokens are returned once and digests are stored | Rotate outstanding deployment credential outside this repository |
| Redis/provider outage | Health checks, broker errors mapped to 503, no fallback in explicit Redis mode | Provider recovery and alerting are operational gates |

## Explicit non-goals

AP provides channel-scoped client authentication, transport-level method/path scopes, and opt-in isolated-host browser origins, but not tenant identity or business authorization. Scopes must not be interpreted as roles, users, tools, or application capabilities. Isolated creation requires `AP_CHANNEL_BASE_DOMAIN`; request host headers never generate public URLs.
