# APP 1.0 — Current Contract

APP is the **AI Proxy Protocol**: the small application contract used by an application reachable through AP.

Its job is simple: describe what the application is and what it exposes.

APP is intentionally separate from AP transport. AP can change brokers, uplinks, or routing behavior without requiring the application's capability model to change.

## Core invariant

> **The root (`/`) is the application's machine-readable landing page. It identifies the application and describes the routes or capabilities the application chooses to expose.**

The application owns this document. AP forwards it; AP does not generate it or decide what the application should expose.

## Current interoperable shape

The reference implementation currently uses:

```json
{
  "protocol": "APP/1.0",
  "application": "Example App",
  "description": "A concise description for an unfamiliar AI client.",
  "routes": [
    {
      "method": "GET",
      "path": "/projects",
      "description": "Lists projects available through this application."
    }
  ]
}
```

For the current proof of concept:

- `protocol` identifies the APP version.
- `application` identifies the private application.
- `description` explains what the application is for.
- `routes` advertises capabilities using ordinary HTTP methods and application-relative paths.
- Each route should explain its purpose clearly enough for an unfamiliar client to decide whether and how to use it.

## Not frozen yet

The example above is the current discovery convention, not a finalized schema specification.

APP has not yet frozen conventions for input/output schemas, authentication declarations, errors, capability metadata, streaming, pagination, or protocol negotiation.

Applications may implement the current shape for interoperability experiments, but should isolate it behind an adapter so later APP 1.0 refinement does not leak throughout the application.

## Namespace behavior

Given public channel:

```text
https://ap.krazybean.com/c/abc123
```

AP maps:

```text
/c/abc123           -> /
/c/abc123/projects  -> /projects
```

Paths in the APP landing page are therefore application-relative. They must not contain the AP channel prefix.

## Design principle

> **AP connects. APP describes. Applications define capability.**

An APP implementation should describe the application honestly and narrowly. Expose only capabilities intended for remote AI use and keep application-specific authorization and semantics in the application layer.
