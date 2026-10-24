# Changelog

All notable changes to AP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

- The home page now opens with a looping hero video of AP's flow: a request waiting in AP's queue, the private application polling outward, and the queued request delivered as the answer to that poll. AP serves the video and its still frame itself (`/hero-<hash>.mp4`, `/hero-<hash>.jpg`, with Range support so Safari plays it), the landing page's CSP gains `media-src 'self'` and `img-src 'self'`, and there are still no scripts.
- The hero has layered fallbacks: if the video cannot play, the still frame from the same render shows; if that cannot load, the flow diagram shows; people who ask for reduced motion get the still. Set `AP_HERO_VIDEO=off` to serve the original static hero to everyone, or open `/?hero=static` to see it. See `docs/HERO.md`.

## [1.2.0] - 2026-10-23

- Accounts: `DELETE /account` (with `{"confirm":"delete-my-account"}` and your `X-AP-Key`) deletes your account and everything AP keeps about it: the account record, all keys, channel and service ownership and usage counts. Operators get `DELETE /admin/accounts/:id` for people who lost their key. New audit event `account.deleted`. Services created before this release have no ownership index, so their owner record is not removed by a delete. The privacy policy, README and `docs/ACCOUNTS.md` describe it.

## [1.1.0] - 2026-10-23

- AP now serves a landing page at `/` and a privacy policy at `/privacy` on its own address (never on isolated channel hostnames). They are static HTML with a locked-down CSP and no scripts. The policy text is in `src/site.ts`; update it whenever what AP collects or keeps changes.

- `npm run login -- google` signs in with Google; plain `npm run login` still uses GitHub.

## [1.0.0] - 2026-10-23

First stable release. See [docs/ROADMAP.md](docs/ROADMAP.md#versioning) for what the version number promises.

- Initial public release.

- Accounts: sign in with Google too. Send `"provider":"google"` to `POST /auth/device` and `/auth/device/token`; no `provider` still means GitHub. `AP_GOOGLE_CLIENT_ID` and `AP_GOOGLE_CLIENT_SECRET` (both required) turn it on. Google accounts are stored as `google:<sub>` and are separate from GitHub accounts; the admin routes accept both id forms. New errors: `unknown_provider`, `provider_mismatch`, `google_error`. See `docs/ACCOUNTS.md`.

- The hosted AP moved from ap.krazybean.com to `https://apchannels.dev`; docs, the example app and the login helper use it. The bare `AP_CHANNEL_BASE_DOMAIN` now serves AP itself instead of answering `404`, so AP and its isolated channels can share one domain.

- Accounts: sign in with GitHub (`npm run login` or `POST /auth/device`) to get an AP key, sent as `X-AP-Key`. Off by default; `AP_GITHUB_CLIENT_ID` turns on sign-in and `AP_REQUIRE_ACCOUNT=true` requires a key on every management and downstream call. Keyed channels and services belong to their account, each account may hold 10 live channels, and operators get `/admin/accounts` (with `AP_ADMIN_TOKEN`) to see usage and disable accounts. See `docs/ACCOUNTS.md`.

- Docs: `docs/EXAMPLE.md` and `examples/hello-app.mjs`, a five-step walkthrough that puts a 40-line app online and calls it.

- `AP_DEFAULT_EXPOSURE=isolated-host` makes channels created without an `exposure` field use their own hostname; `AP_EXPOSURE=isolated-host` does the same for the reference mock app.

- Security: responses on shared `/c/{channel}` paths now carry a CSP sandbox and `X-Content-Type-Options: nosniff`, and drop `Service-Worker-Allowed`, so one channel's page cannot read AP or other channels. Isolated hosts are unchanged.

- Docs: `docs/SETUP.md` walks through connecting a wildcard domain for isolated channel hostnames on Vercel.
