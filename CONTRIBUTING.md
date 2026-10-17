# Contributing to AP

Thanks for being here. AP is infrastructure, so the bar is correctness and clarity — not cleverness.

## Ground rules

- **Small, focused PRs.** One change per PR. If it does two things, it's two PRs.
- **No vibe code.** If you used an AI assistant, say so in the PR description and review its output like you wrote it yourself — because you shipped it.
- **Tests for behavior changes.** `npm test` must pass. If you're fixing a bug, add a regression test that fails without the fix.
- **Docs with features.** A feature without docs is a rumor. Update README or `docs/` accordingly.

## Getting started

```bash
npm install
npm test
```

`npm test` uses the in-memory broker. Production uses Redis, so CI also runs the whole suite against real Redis behind the Upstash REST API. To run that locally:

```bash
docker network create ap-test
docker run -d --name ap-redis --network ap-test redis:7
docker run -d --name ap-srh --network ap-test -p 8079:80 \
  -e SRH_MODE=env -e SRH_TOKEN=local_token -e SRH_CONNECTION_STRING=redis://ap-redis:6379 \
  hiett/serverless-redis-http
UPSTASH_REDIS_REST_URL=http://localhost:8079 UPSTASH_REDIS_REST_TOKEN=local_token npm run test:redis
```

## Reporting issues

Use the issue templates. Include: what you expected, what happened, version (`ap --version` or package version), and minimal reproduction steps. "It doesn't work" will be closed.

## Security

Don't open public issues for vulnerabilities. See SECURITY.md.
