# Changelog

All notable changes to AP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

- Accounts: sign in with GitHub (`npm run login` or `POST /auth/device`) to get an AP key, sent as `X-AP-Key`. Off by default; `AP_GITHUB_CLIENT_ID` turns on sign-in and `AP_REQUIRE_ACCOUNT=true` requires a key on every management and downstream call. Keyed channels and services belong to their account, each account may hold 10 live channels, and operators get `/admin/accounts` (with `AP_ADMIN_TOKEN`) to see usage and disable accounts. See `docs/ACCOUNTS.md`.

- Docs: `docs/EXAMPLE.md` and `examples/hello-app.mjs`, a five-step walkthrough that puts a 40-line app online and calls it.

- `AP_DEFAULT_EXPOSURE=isolated-host` makes channels created without an `exposure` field use their own hostname; `AP_EXPOSURE=isolated-host` does the same for the reference mock app.

- Security: responses on shared `/c/{channel}` paths now carry a CSP sandbox and `X-Content-Type-Options: nosniff`, and drop `Service-Worker-Allowed`, so one channel's page cannot read AP or other channels. Isolated hosts are unchanged.

- Docs: `docs/SETUP.md` walks through connecting a wildcard domain for isolated channel hostnames on Vercel.

## [0.1.0] - TBD

- Initial public release.
