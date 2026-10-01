# Security Verification Report

## Baseline environment

- Starting commit: `e802e526dd5feab5e4f054652aac0e6b48a81c09`
- Node: `v20.20.2` (the system default was Node 8 and is not supported)
- Dependencies: installed with `npm ci` from `package-lock.json`
- Redis credentials: not present in the environment; live verification is BLOCKED

## Tests and build

The untouched baseline passed `npm test`: 60 tests, 56 passed, 4 skipped real-Redis tests, 0 failed. `npm run build` passed.

Wave 2D and AP 1.1 add local telemetry, named-service contract, binding, stale-pruning, Redis atomicity, and adversarial tests. Final counts and the ending branch SHA are recorded in the delivery report. The required gates remain `npm test`, `npm run build`, `npm audit --audit-level=high`, `npm run security:scan`, `npm run security:load`, and CycloneDX SBOM generation with `npm sbom`.

## Runtime verification status

Fake-Redis and memory-broker regression coverage verifies queue/in-flight bounds, timeout release, response ownership, malformed IDs, body limits, header filtering, health caching, and controlled broker errors. The reproducible `npm run security:load` harness exercises 200 malformed/nonexistent-channel probes, 200 capacity-rejected known-channel requests, and an oversized request.
Named-service coverage verifies the strict grammar, reserved names, one-time secret behavior, duplicate races, two-secret ownership, exclusive/idempotent binding, the 16-instance limit, stale pruning, and channel preservation after unbind.

Live Redis queue capacity, in-flight capacity, timeout release, multi-instance sharing, Lua return values/atomicity, and bounded TTL cleanup were not run because credentials are unavailable. They must not be marked complete until `AP_REDIS_INTEGRATION=1 npm test` and live load/TTL checks run against a disposable test namespace.

## Failure injection

Existing tests cover broker health failure and provider/quota error mapping. A live Redis outage during dispatch/response and a downstream reconnect/poll failure remain deployment verification tasks.

## Unresolved risks

- No client authorization beyond capability URLs.
- Shared browser origin; cookie stripping is not tenant isolation.
- Audit storage is operational logging only; no durable export or retention policy is implemented.
- Distributed edge/WAF throttling is not represented as deployed repository state.
- Outstanding deployment credential rotation is not verified.
- Live Redis/Lua/TTL evidence is blocked by missing credentials.
