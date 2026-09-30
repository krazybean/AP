# Security Verification Report

## Baseline environment

- Starting commit: `99451e40e02ac38f8725ba31e86eeb56203836d0`
- Node: `v20.20.2` (the system default was Node 8 and is not supported)
- Dependencies: installed with `npm ci` from `package-lock.json`
- Redis credentials: not present in the environment; live verification is BLOCKED

## Tests and build

The untouched baseline passed `npm test`: 44 tests, 40 passed, 4 skipped real-Redis tests, 0 failed. `npm run build` passed.

Final local validation passed: `npm test` (40 passed, 4 skipped, 0 failed), `npm run build`, `npm audit --audit-level=high` (0 vulnerabilities), `npm run security:scan`, `npm run security:load`, and CycloneDX SBOM generation with `npm sbom`.

## Runtime verification status

Fake-Redis and memory-broker regression coverage verifies queue/in-flight bounds, timeout release, response ownership, malformed IDs, body limits, header filtering, health caching, and controlled broker errors. The reproducible `npm run security:load` harness exercises 200 malformed/nonexistent-channel probes, 200 capacity-rejected known-channel requests, and an oversized request.

Live Redis queue capacity, in-flight capacity, timeout release, multi-instance sharing, Lua return values/atomicity, and bounded TTL cleanup were not run because credentials are unavailable. They must not be marked complete until `AP_REDIS_INTEGRATION=1 npm test` and live load/TTL checks run against a disposable test namespace.

## Failure injection

Existing tests cover broker health failure and provider/quota error mapping. A live Redis outage during dispatch/response and a downstream reconnect/poll failure remain deployment verification tasks.

## Unresolved risks

- No client authorization beyond capability URLs.
- Shared browser origin; cookie stripping is not tenant isolation.
- Distributed edge/WAF throttling is not represented as deployed repository state.
- Outstanding deployment credential rotation is not verified.
- Live Redis/Lua/TTL evidence is blocked by missing credentials.
