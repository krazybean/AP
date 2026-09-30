# AP Security Baseline

Status vocabulary: PASS = implemented with evidence; PARTIAL = mitigation exists but material residual risk remains; DEFERRED = intentionally left for a later wave; N/A = not applicable.

This maps applicable OWASP API Security Top 10 (2023) risks and selected OWASP ASVS 5.0 Level 2 themes. It is an internal traceable baseline, not formal compliance.

| Control | Status | Evidence | Remaining risk |
|---|---|---|---|
| API1 Broken Object Level Authorization | PASS | Per-channel bearer client credentials, downstream ownership checks, cross-channel tests | No scopes; Wave 2B |
| API2 Broken Authentication | PASS | `X-AP-Access-Token`, digest storage, expiry/revocation, metrics token; `test/client-auth.test.ts` | No external identity provider; intentional channel-scoped model |
| API3 Broken Object Property Level Authorization | PASS | Response envelope validation in `src/routes.ts` | Application-specific payload policy is downstream-owned |
| API4 Unrestricted Resource Consumption | PASS | Body limit, queue/in-flight caps, timeouts, rate limits; capacity tests | Distributed edge/WAF controls are an external gate |
| API5 Broken Function Level Authorization | PARTIAL | Downstream endpoints require secret | Client-facing policy model is deferred |
| API6 Unrestricted Access to Sensitive Business Flows | PARTIAL | Channel creation rate limit and license option | No identity-aware client policy |
| API7 Server Side Request Forgery | PASS | AP routes through an existing channel; AP does not accept arbitrary destination URLs or initiate private-network connections | Downstream remains trusted only within its secret boundary |
| API8 Security Misconfiguration | PASS | Invalid security-sensitive env values fail; explicit broker mode; CI audit/build/test | Platform/WAF settings require deployment verification |
| API9 Improper Inventory Management | PASS | Small documented route surface and operations docs | Inventory monitoring is manual |
| API10 Unsafe Consumption of APIs | PARTIAL | Downstream headers filtered and response envelopes validated | Downstream is a security boundary, not a fully trusted tenant |
| ASVS L2 input/output validation | PASS | UUID validation, body limit, response validation, header filtering; tests | Continue adversarial regression coverage |
| ASVS L2 error handling/logging | PARTIAL | Broker failures become controlled 503s; metrics access controlled | Enable platform-native secret scanning and review production log sinks |
| ASVS L2 dependency/configuration management | PASS | `npm ci`, lockfile, audit, pinned actions, SBOM | Credential rotation and GitHub settings are external |

## Wave 2A boundary

This wave separates channel identity from public-client authorization without changing the public-channel default. Ordinary application `Authorization` remains transport data; AP client authentication uses `X-AP-Access-Token`.

## Wave 2

Design first-class client authorization with rotation, revocation, expiry, replay handling, scoped policy, and auditability. Investigate `<channel>.channels.ap.krazybean.com` or equivalent origin separation. Do not treat this document as evidence those controls exist today.
