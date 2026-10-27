# Changelog

All notable changes to AP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

- Website analytics, opt-in: set `AP_GA_ID` to a GA4 measurement id and the home page and privacy policy show a consent banner (Accept or Decline, plus a footer "Cookie settings" link). Google Analytics and its cookies load only after Accept, with Consent Mode defaulting to denied and Google signals and ad personalisation off; Decline deletes the `_ga` cookies. It never runs on channel traffic, the API, or the embedded demo. Unset, the pages and their `default-src 'none'` CSP are unchanged. When enabled the privacy policy describes analytics and the cookies instead of saying there are none.

- Polling: `GET /channels/:channel/next` honours `X-AP-Activity: none`, a keepalive that exchanges no data. AP checks the channel secret and answers `204` at once: it does not wait, deliver a queued request, or refresh the channel's 15-minute inactivity timer or bearer-access timer. On Redis that is one read instead of a polling loop of reads and `EXPIRE`s (about 11 commands for an idle 25 s poll). Any other value, or no header, behaves as before.
- The home page now opens with an interactive 3D demonstration of AP's flow: a request waiting in AP's queue, the private application polling outward, and the queued request delivered as the answer to that poll. Drag to orbit, jump between the nine stages, pause and replay. It is also available full screen at `/demo`.
- The landing page itself still has no script. The demo is a separate page (`/demo`) in an `<object>`, with its own CSP (`script-src 'self' blob:`, nothing from any other origin, framable only by AP). AP serves the demo and the hero media itself (`/demo-assets/*`, `/hero-<hash>.mp4`, `/hero-<hash>.jpg`), and the landing CSP gains `media-src`, `object-src`, `frame-src` and `img-src` for `'self'`.
- Every failure falls back by itself: if the demo cannot load, the recorded still frame shows; with no WebGL, a phone-sized hero or a crash, the demo page plays a recorded video; with reduced motion, the still; if that fails too, the flow diagram. `/?hero=video` and `/?hero=static` show the video hero and the original static hero on demand, and `AP_HERO=video|static` makes either the default for everyone. See `docs/HERO.md`.

- Docs: the README opens with the hero diagram (`docs/assets/ap-hero.png`) in place of the ASCII sketch.

- Docs: the versioning policy in `docs/ROADMAP.md` now treats small additive changes as patch releases (`1.2.x`) and keeps minor bumps for larger announced capabilities.

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
