# Anti-Vibe Engineering Agenda

This is the engineering-maturity backlog, separate from product features.

## AV-0 — Critical Integrity

- [ ] Before external beta: revoke and rotate the deployment credential currently present in local environment state.
- [ ] Before external beta: remove persisted deployment credentials from developer workspaces and use managed secret injection.

## AV-1 — External Beta Gate

- [x] Add Node 20 CI validation for install, build, and tests.
- [x] Add regression coverage for documented unknown-channel and unknown-request failures.
- [x] Preserve unexpected broker failures instead of misreporting them as client errors.
- [x] Define and enforce lightweight per-channel downstream ownership.
- [x] Bind Redis responses to short-lived pending request IDs.
- [x] Add Redis broker ownership and timeout regression tests.
- [x] Define cancellation and expiry behavior for timed-out requests.
- [x] Validate downstream response envelopes at the HTTP boundary.
- [x] Add an opt-in real Redis round-trip test.
- [x] Run the Redis round-trip test against the attached Upstash environment.
- [x] Add opt-in Redis integration tests for delivery, timeout, expiry, and restart behavior.

## AV-2 — Product Gate

- [ ] Add authentication and authorization for channel creation and channel traffic.
- [x] Add prototype rate limiting for channel creation per source IP.
- [ ] Consider application license identity as a stronger limiter key if source-IP limiting becomes insufficient.
- [x] Enforce a 15-minute inactivity expiry consistently in local and Redis brokers.
- [x] Keep reconnect behavior simple: create a new channel.
- [ ] Define durable application identity and channel reclaim behavior.
- [x] Add dependency/security scanning to CI.

## AV-3 — Professionalization

- [x] Add structured counters for channel creation, proxy traffic, timeouts, and broker errors.
- [x] Make `/health` check broker availability and reject degraded state with HTTP 503.
- [x] Add operational runbooks and recovery procedures.
- [x] Add process-local queued and in-flight request metrics.

AV-4 is not currently applicable; commercial distribution requirements are not part of the stated project scope.
