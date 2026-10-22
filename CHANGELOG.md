# Changelog

All notable changes to AP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

- `AP_DEFAULT_EXPOSURE=isolated-host` makes channels created without an `exposure` field use their own hostname; `AP_EXPOSURE=isolated-host` does the same for the reference mock app.

- Security: responses on shared `/c/{channel}` paths now carry a CSP sandbox and `X-Content-Type-Options: nosniff`, and drop `Service-Worker-Allowed`, so one channel's page cannot read AP or other channels. Isolated hosts are unchanged.

- Docs: `docs/SETUP.md` walks through connecting a wildcard domain for isolated channel hostnames on Vercel.

## [0.1.0] - TBD

- Initial public release.
