# AP Security Baseline

Status vocabulary: PASS = implemented with evidence; PARTIAL = mitigation exists but material residual risk remains; DEFERRED = intentionally left for a later wave; N/A = not applicable.

This maps applicable OWASP API Security Top 10 (2023) risks and selected OWASP ASVS 5.0 Level 2 themes. It is an internal traceable baseline, not formal compliance.

| Control | Status | Evidence | Remaining risk |
|---|---|---|---|
| API1 Broken Object Level Authorization | PASS | Per-channel bearer credentials, immutable method/path scopes, hostname-selected isolated channels, downstream ownership checks, cross-channel tests | No application identity or scopes beyond transport paths |
| API2 Broken Authentication | PASS | `X-AP-Access-Token`, digest storage, expiry/revocation, metrics token; `test/client-auth.test.ts` | No external identity provider; intentional channel-scoped model |
| API3 Broken Object Property Level Authorization | PASS | Response envelope validation in `src/routes.ts` | Application-specific payload policy is downstream-owned |
| API4 Unrestricted Resource Consumption | PASS | Body limit, queue/in-flight caps, timeouts, rate limits; capacity tests | Distributed edge/WAF controls are an external gate |
| API5 Broken Function Level Authorization | PASS | Credential-scoped method/path authorization before dispatch; `test/client-scopes.test.ts` | No business-function or capability semantics |
| API6 Unrestricted Access to Sensitive Business Flows | PARTIAL | Channel creation rate limit and license option | No identity-aware client policy |
| API7 Server Side Request Forgery | PASS | AP routes through an existing channel; AP does not accept arbitrary destination URLs or initiate private-network connections | Downstream remains trusted only within its secret boundary |
| API8 Security Misconfiguration | PASS | Invalid security-sensitive env values fail; explicit broker mode; CI audit/build/test | Platform/WAF settings require deployment verification |
| API9 Improper Inventory Management | PASS | Small documented route surface, explicit path/isolated-host exposure, and operations docs | Inventory monitoring is manual |
| API10 Unsafe Consumption of APIs | PARTIAL | Downstream headers filtered and response envelopes validated | Downstream is a security boundary, not a fully trusted tenant |
| ASVS L2 input/output validation | PASS | UUID validation, body limit, response validation, header filtering; tests | Continue adversarial regression coverage |
| ASVS L2 error handling/logging | PARTIAL | Broker failures become controlled 503s; metrics access controlled | Enable platform-native secret scanning and review production log sinks |
| ASVS L2 dependency/configuration management | PASS | `npm ci`, lockfile, audit, pinned actions, SBOM | Credential rotation and GitHub settings are external |
| ASVS L2 security telemetry privacy | PASS | Fixed audit-event unions, bounded security metrics, request-ID response header, redaction/leakage tests | Default audit sink is operational logging, not durable storage |

## Wave 2A/2B boundary

Wave 2A separates channel identity from public-client authorization without changing the public-channel default. Wave 2B adds immutable credential-scoped HTTP method/path authorization. Ordinary application `Authorization` remains transport data; AP client authentication uses `X-AP-Access-Token`.

Scope matching is transport-only: exact paths, trailing subtree wildcards, and `/*`; no roles, users, capabilities, regex, or policy language. Ambiguous encoded/dot-segment paths fail closed before dispatch.

## Wave 2C boundary

Wave 2C adds opt-in browser-origin isolation through trusted per-channel hostnames. The base domain is configuration-only, host parsing is exact and label-boundary checked, and isolated hosts route all paths to the selected downstream channel. It does not add permissive CORS, AP cookies, or generic browser response policies.

## Wave 2D boundary

Wave 2D adds local structured security audit events, bounded security metrics, and generated request correlation IDs. Telemetry is best-effort and cannot authorize, deny, route, or admit traffic. Channel identifiers may appear in audit records when useful for investigation, but never in metric dimensions.

## Wave 2

Future work includes first-class identity, replay handling, richer auditability, and deliberate browser policy controls. Custom domains and business authorization remain out of scope.
