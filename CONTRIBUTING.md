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

## Reporting issues

Use the issue templates. Include: what you expected, what happened, version (`ap --version` or package version), and minimal reproduction steps. "It doesn't work" will be closed.

## Security

Don't open public issues for vulnerabilities. See SECURITY.md.
