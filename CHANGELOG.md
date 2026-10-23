# Changelog

All notable changes to AP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

- Accounts: sign in with Google too. Send `"provider":"google"` to `POST /auth/device` and `/auth/device/token`; no `provider` still means GitHub. `AP_GOOGLE_CLIENT_ID` and `AP_GOOGLE_CLIENT_SECRET` (both required) turn it on. Google accounts are stored as `google:<sub>` and are separate from GitHub accounts; the admin routes accept both id forms. New errors: `unknown_provider`, `provider_mismatch`, `google_error`. See `docs/ACCOUNTS.md`.

- The hosted AP moved from ap.krazybean.com to `https://apchannels.dev`; docs, the example app and the login helper use it. The bare `AP_CHANNEL_BASE_DOMAIN` now serves AP itself instead of answering `404`, so AP and its isolated channels can share one domain.

- Accounts: sign in with GitHub (`npm run login` or `POST /auth/device`) to get an AP key, sent as `X-AP-Key`. Off by default; `AP_GITHUB_CLIENT_ID` turns on sign-in and `AP_REQUIRE_ACCOUNT=true` requires a key on every management and downstream call. Keyed channels and services belong to their account, each account may hold 10 live channels, and operators get `/admin/accounts` (with `AP_ADMIN_TOKEN`) to see usage and disable accounts. See `docs/ACCOUNTS.md`.

- Docs: `docs/EXAMPLE.md` and `examples/hello-app.mjs`, a five-step walkthrough that puts a 40-line app online and calls it.

- `AP_DEFAULT_EXPOSURE=isolated-host` makes channels created without an `exposure` field use their own hostname; `AP_EXPOSURE=isolated-host` does the same for the reference mock app.

- Security: responses on shared `/c/{channel}` paths now carry a CSP sandbox and `X-Content-Type-Options: nosniff`, and drop `Service-Worker-Allowed`, so one channel's page cannot read AP or other channels. Isolated hosts are unchanged.

- Docs: `docs/SETUP.md` walks through connecting a wildcard domain for isolated channel hostnames on Vercel.

## [0.1.0] - TBD

- Initial public release.
