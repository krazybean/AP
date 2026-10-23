# Setting up isolated channel hostnames

By default every channel lives under AP's own domain at `/c/<channel>`. An **isolated-host** channel instead gets its own hostname, such as `https://<channel>.apchannels.dev/`, so each channel is a separate browser origin. This guide connects a wildcard domain to an AP deployment on Vercel and checks it end to end.

The hosted instance uses `apchannels.dev` with DNS on Cloudflare. Substitute your own domain throughout.

Before you start, you need:

- AP deployed on Vercel with Redis configured (`AP_BROKER=redis` and the Upstash credentials; see [OPERATIONS.md](OPERATIONS.md#broker-selection))
- a domain dedicated to channels. Every hostname under it is handed to channel traffic, so AP's own address must be either a different domain or the bare domain itself (the hosted instance serves AP at `https://apchannels.dev`; see [Serving AP from the bare domain](#serving-ap-from-the-bare-domain)).

## 1. Add the wildcard domain to the AP project

In Vercel, open the existing AP project (don't create a new one), go to **Settings → Domains**, click **Add Existing** and enter `*.apchannels.dev`. Assign it to **Production**.

Vercel will show **Invalid Configuration** until the DNS steps below are done.

## 2. Configure DNS

Vercel needs to issue a wildcard certificate, which requires a DNS challenge it can answer. There are two ways to allow that.

### Option A: keep your DNS provider (what the hosted instance does)

Vercel only needs control of the `_acme-challenge` name. In your DNS provider (Cloudflare here: the domain → **DNS → Records**), add:

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| NS | `_acme-challenge` | `ns1.vercel-dns.com` | n/a |
| NS | `_acme-challenge` | `ns2.vercel-dns.com` | n/a |
| CNAME | `*` | `cname.vercel-dns.com` | **DNS only** (grey cloud) |

The wildcard CNAME must not be proxied. With Cloudflare's proxy on, Cloudflare terminates TLS instead of Vercel and the wildcard certificate cannot be used.

Existing records such as the apex or `www` can stay: a specific record always takes precedence over the wildcard.

Back in Vercel, click **Refresh** on the domain. It changes to **DNS Change Recommended**. That label is Vercel suggesting its own nameservers, and it can be left as is. See Vercel's guide, [Why use the nameservers method for wildcard domains](https://vercel.com/guides/why-use-domain-nameservers-method-wildcard-domains).

### Option B: move the domain to Vercel DNS

At your registrar, set the domain's nameservers to `ns1.vercel-dns.com` and `ns2.vercel-dns.com`. Vercel then manages all DNS for the domain, including the wildcard and its certificate. This is simpler, but any other records (mail, apex, `www`) must be recreated in Vercel.

## 3. Check the domain reaches AP

```bash
curl -i https://test.apchannels.dev/
```

A working setup returns a response from AP with a valid certificate. Because AP doesn't know the domain yet, expect:

```text
HTTP/2 404
...
{"error":"not_found"}
```

A TLS or certificate error means Vercel is still issuing the certificate. Wait a few minutes and retry.

## 4. Tell AP the base domain

In Vercel, go to **Settings → Environment Variables** and add:

| Key | Value | Environment |
| --- | --- | --- |
| `AP_CHANNEL_BASE_DOMAIN` | `apchannels.dev` | Production |

Use the bare domain, with no scheme, no `*.` and no trailing slash. AP builds channel URLs only from this setting; it never trusts `Host` or forwarding headers.

Environment variables apply only to new deployments, so redeploy: **Deployments → ⋯ on the latest production deployment → Redeploy**.

## 5. Create an isolated channel

```bash
curl -s -X POST https://apchannels.dev/channels \
  -H 'content-type: application/json' \
  -d '{"exposure":{"mode":"isolated-host"}}'
```

The response includes the channel's own URL:

```json
{
  "channel": "3f2b6c1e-8a4d-4e7f-9b2a-5c6d7e8f9a0b",
  "secret": "...",
  "url": "https://3f2b6c1e-8a4d-4e7f-9b2a-5c6d7e8f9a0b.apchannels.dev/",
  "exposure": { "mode": "isolated-host" },
  "access": { "mode": "public" }
}
```

If you get `503` with `isolated_host_not_configured`, the environment variable didn't reach the running deployment. Check its spelling and environment, then redeploy.

## 6. Send a request through it

Play both sides in two terminals. Start the private app first, because a client waits only about 30 seconds for an answer.

**Terminal 1, the private app**: wait for a request, then answer it.

```bash
CH=<channel>
SECRET='<secret>'
REQ=""
while [ -z "$REQ" ]; do echo "waiting..."; REQ=$(curl -s https://apchannels.dev/channels/$CH/next -H "authorization: Bearer $SECRET"); done
echo "$REQ"
ID=$(echo "$REQ" | sed -E 's/.*"id":"([^"]+)".*/\1/')
curl -s -X POST https://apchannels.dev/channels/$CH/responses/$ID \
  -H "authorization: Bearer $SECRET" -H 'content-type: application/json' \
  -d '{"statusCode":200,"body":{"hello":"from my app"}}'
```

**Terminal 2, the client**: once Terminal 1 prints `waiting...`:

```bash
curl -i https://<channel>.apchannels.dev/hello
```

Expected:

```text
HTTP/2 200
...
{"hello":"from my app"}
```

A `504` with `downstream_timeout` means the request reached the channel but nothing answered it in time; usually Terminal 1 wasn't waiting yet.

The reference app does the same thing in one command, and prints the channel's address:

```bash
AP_URL=https://apchannels.dev AP_EXPOSURE=isolated-host npm run mock:downstream
```

## 7. Optional: make isolated hosts the default

Channels that don't ask for an exposure mode are path channels. To give them their own hostname instead, add this environment variable and redeploy:

| Key | Value | Environment |
| --- | --- | --- |
| `AP_DEFAULT_EXPOSURE` | `isolated-host` | Production |

Apps can still ask for a path channel with `{"exposure":{"mode":"path"}}`. Before turning this on, check that the apps you run use the `url` AP returns rather than building `/c/<channel>` themselves, since isolated channels return `404` on that form. `AP_DEFAULT_EXPOSURE` accepts only `path` (the default) or `isolated-host`; any other value stops AP at startup.

## Serving AP from the bare domain

AP treats the bare base domain (`apchannels.dev`) as its own address and every name under it as a channel. To serve AP there:

1. In Vercel, open the AP project → **Settings → Domains → Add Existing**, enter `apchannels.dev` and assign it to **Production**. Vercel shows the A record it wants.
2. In Cloudflare, set the apex record (`@`, type A) to that value with **DNS only** (grey cloud). Remove any parking record for the apex.
3. Check it:

```bash
curl -s https://apchannels.dev/health
```

It should return `"service":"ap"`. Don't use a subdomain such as `api.apchannels.dev` for AP: AP would treat it as a malformed channel host and answer `404`.

## Behavior on isolated hostnames

- The bare `<base-domain>` is AP itself; any other name under it that isn't a channel ID returns `404`.
- Every path on `<channel>.<base-domain>`, including `/health`, `/metrics` and `/channels/*`, is application traffic for that channel.
- The shared form `/c/<channel>` returns `404` for an isolated channel; give clients the absolute URL from creation.
- Channels still expire after 15 minutes without activity.

For the full request and response format see [INTEGRATION.md](INTEGRATION.md); for operational details see [OPERATIONS.md](OPERATIONS.md).
